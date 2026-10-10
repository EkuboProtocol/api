import { createServer, type Server, type Socket } from "node:net";

// A minimal PostgreSQL wire-protocol server for tests that need a real
// postgres.js client without a database. It accepts any startup without
// authentication and answers the extended-query flow postgres.js uses. Every
// query returns `rows` (all columns as text), or fails with `error` if set.
export interface FakePostgresOptions {
  readonly rows?: readonly Record<string, string>[];
  readonly error?: {
    readonly code: string;
    readonly message: string;
  };
}

export interface FakePostgres {
  readonly url: string;
  readonly close: () => Promise<void>;
}

const TEXT_OID = 25;

function message(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0, "latin1");
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

function int16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeInt16BE(n);
  return b;
}

function int32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeInt32BE(n);
  return b;
}

const cstring = (s: string) => Buffer.from(`${s}\0`, "utf8");

function rowDescription(columns: readonly string[]): Buffer {
  return message(
    "T",
    Buffer.concat([
      int16(columns.length),
      ...columns.map((name) =>
        Buffer.concat([
          cstring(name),
          int32(0),
          int16(0),
          int32(TEXT_OID),
          int16(-1),
          int32(-1),
          int16(0),
        ]),
      ),
    ]),
  );
}

function dataRow(values: readonly string[]): Buffer {
  return message(
    "D",
    Buffer.concat([
      int16(values.length),
      ...values.flatMap((value) => {
        const bytes = Buffer.from(value, "utf8");
        return [int32(bytes.length), bytes];
      }),
    ]),
  );
}

function errorResponse(code: string, text: string): Buffer {
  return message(
    "E",
    Buffer.concat([
      Buffer.from("S"),
      cstring("ERROR"),
      Buffer.from("V"),
      cstring("ERROR"),
      Buffer.from("C"),
      cstring(code),
      Buffer.from("M"),
      cstring(text),
      Buffer.from("R"),
      cstring("fake_routine"),
      Buffer.from([0]),
    ]),
  );
}

// Parameter type OIDs from a Parse message: name\0 query\0 int16 n, int32[n].
function parseParameterTypes(body: Uint8Array): number[] {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  let i = body.indexOf(0) + 1;
  i = body.indexOf(0, i) + 1;
  const count = view.getInt16(i);
  return Array.from(
    { length: count },
    (_, k) => view.getInt32(i + 2 + k * 4) || TEXT_OID,
  );
}

const STARTUP_REPLY = Buffer.concat([
  message("R", int32(0)),
  message("S", Buffer.concat([cstring("server_version"), cstring("16.0")])),
  message("K", Buffer.concat([int32(1), int32(1)])),
  message("Z", Buffer.from("I")),
]);

const EMPTY = Buffer.alloc(0);

interface ConnectionState {
  readonly socket: Socket;
  readonly options: FakePostgresOptions;
  readonly columns: readonly string[];
  parameterTypes: number[];
  failed: boolean;
}

type Handler = (state: ConnectionState, body: Uint8Array) => Buffer;

// Replies to each frontend message type of the extended-query protocol.
const HANDLERS: Record<string, Handler> = {
  P: (state, body) => {
    state.parameterTypes = parseParameterTypes(body);
    if (!state.options.error) return message("1");
    state.failed = true;
    return errorResponse(state.options.error.code, state.options.error.message);
  },
  D: (state, body) =>
    Buffer.concat([
      body[0] === "S".charCodeAt(0)
        ? message(
            "t",
            Buffer.concat([
              int16(state.parameterTypes.length),
              ...state.parameterTypes.map(int32),
            ]),
          )
        : EMPTY,
      state.columns.length > 0 ? rowDescription(state.columns) : message("n"),
    ]),
  B: () => message("2"),
  E: (state) => {
    const rows = state.options.rows ?? [];
    return Buffer.concat([
      ...rows.map((row) => dataRow(state.columns.map((c) => row[c] ?? ""))),
      message("C", cstring(`SELECT ${rows.length}`)),
    ]);
  },
  S: (state) => {
    state.failed = false;
    return message("Z", Buffer.from("I"));
  },
  C: () => message("3"),
  X: (state) => {
    state.socket.end();
    return EMPTY;
  },
};

function reply(state: ConnectionState, type: string, body: Uint8Array) {
  // After an error the server skips everything up to the next Sync.
  if (state.failed && type !== "S") return EMPTY;
  return HANDLERS[type]?.(state, body) ?? EMPTY;
}

function connection(socket: Socket, options: FakePostgresOptions) {
  const state: ConnectionState = {
    socket,
    options,
    columns: Object.keys(options.rows?.[0] ?? {}),
    parameterTypes: [],
    failed: false,
  };
  let buffer = Buffer.alloc(0);
  let started = false;

  socket.on("data", (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    const out: Buffer[] = [];
    for (;;) {
      if (!started) {
        if (buffer.length < 8) break;
        const length = buffer.readInt32BE(0);
        if (buffer.length < length) break;
        const code = buffer.readInt32BE(4);
        buffer = buffer.subarray(length);
        // SSLRequest: refuse, the client then sends a plain startup message.
        if (code === 80877103) out.push(Buffer.from("N"));
        else {
          started = true;
          out.push(STARTUP_REPLY);
        }
        continue;
      }
      if (buffer.length < 5) break;
      const length = buffer.readInt32BE(1);
      if (buffer.length < length + 1) break;
      const type = String.fromCharCode(buffer[0]!);
      const body = buffer.subarray(5, length + 1);
      buffer = buffer.subarray(length + 1);
      out.push(reply(state, type, body));
    }
    if (out.length > 0) socket.write(Buffer.concat(out));
  });
  socket.on("error", () => socket.destroy());
}

export async function startFakePostgres(
  options: FakePostgresOptions = {},
): Promise<FakePostgres> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    connection(socket, options);
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("fake postgres did not bind a TCP port");
  }
  return {
    url: `postgres://fake:fake@127.0.0.1:${address.port}/fake`,
    close: () =>
      new Promise<void>((resolve) => {
        sockets.forEach((socket) => socket.destroy());
        server.close(() => resolve());
      }),
  };
}
