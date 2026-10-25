# Frozen zero-seed launch vectors

Copied byte for byte from the source freeze of EkuboProtocol/evm-contracts
commit `853b608ec26d4c80bdad6e394cb8ba686e1ae615` (`test/vectors/`). Local
Forge execution and Python oracles, never deployed: untrusted input, not
live-chain evidence. `policy.test.ts` checks these hashes.

| File | sha256 |
|---|---|
| `zero-seed-launch.json` | `e5444bf6b1f7e422238331b50b64cf0400597bd13421e281615735511274190b` |
| `zero-seed-launch-installation.json` | `5cf44854cbf00abb700936b2e22782c27dac5e68cf892edc8f5aa7090067a555` |
| `zero-seed-launch-events.json` | `24dd5883ce242ec523517c9f38cfd5e8ca29740974aeded5740ac3608e1e7066` |

ABI file hashes used by `policy.ts` (`SHA256SUMS.json` of the freeze):
`ZeroSeedLaunch.abi.json` `6a131c2d2f70f85a5e2a54395b9d77c4dd5028a7a4bbf632f3d3364ac61e56eb`,
`ZeroSeedLaunchPeriphery.abi.json` `5d05426f8190cb0bcd6a021e7aceb46f468708cb36bd5a5d818548650499c839`.
