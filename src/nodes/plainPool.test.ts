import { PlainPool } from "./plainPool";
import { MAX_SQRT_RATIO, MIN_SQRT_RATIO, toSqrtRatio } from "../math/tick";

describe("PoolNode", () => {
  describe("findNearestInitializedTickIndex", () => {
    it("no ticks", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      expect(pool.findNearestInitializedTickIndex(0)).toBe(-1);
    });
    it("one tick less than", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [{ tick: -1, liquidityDelta: 1n }],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      expect(pool.findNearestInitializedTickIndex(0)).toBe(0);
    });
    it("one tick equal to", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [{ tick: 0, liquidityDelta: 1n }],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      expect(pool.findNearestInitializedTickIndex(0)).toBe(0);
    });
    it("one tick greater than", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [{ tick: 1, liquidityDelta: 1n }],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      expect(pool.findNearestInitializedTickIndex(0)).toBe(-1);
    });
    it("many ticks", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [
          { tick: -100, liquidityDelta: 0n },
          { tick: -5, liquidityDelta: 0n },
          { tick: -4, liquidityDelta: 0n },
          { tick: 18, liquidityDelta: 0n },
          { tick: 23, liquidityDelta: 0n },
          { tick: 50, liquidityDelta: 0n },
        ],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      expect(pool.findNearestInitializedTickIndex(-101)).toBe(-1);
      expect(pool.findNearestInitializedTickIndex(-100)).toBe(0);
      expect(pool.findNearestInitializedTickIndex(-99)).toBe(0);
      expect(pool.findNearestInitializedTickIndex(-6)).toBe(0);
      expect(pool.findNearestInitializedTickIndex(-5)).toBe(1);
      expect(pool.findNearestInitializedTickIndex(-4)).toBe(2);
      expect(pool.findNearestInitializedTickIndex(-3)).toBe(2);
      expect(pool.findNearestInitializedTickIndex(0)).toBe(2);
      expect(pool.findNearestInitializedTickIndex(17)).toBe(2);
      expect(pool.findNearestInitializedTickIndex(18)).toBe(3);
      expect(pool.findNearestInitializedTickIndex(19)).toBe(3);
      expect(pool.findNearestInitializedTickIndex(22)).toBe(3);
      expect(pool.findNearestInitializedTickIndex(23)).toBe(4);
      expect(pool.findNearestInitializedTickIndex(24)).toBe(4);
      expect(pool.findNearestInitializedTickIndex(49)).toBe(4);
      expect(pool.findNearestInitializedTickIndex(50)).toBe(5);
      expect(pool.findNearestInitializedTickIndex(51)).toBe(5);
    });
  });

  describe("quote", () => {
    it("works for 0 liquidity 1 token1 input", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      const { executionResources, calculatedAmount } = pool.quote({
        specifiedAmount: 1n,
        isToken1: true,
      });

      expect(calculatedAmount).toEqual(0n);
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.sqrtRatioAfter).toEqual(MAX_SQRT_RATIO);
    });
    it("works for 0 liquidity 1 token0 input", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [],
        liquidity: 0n,
        sqrtRatio: 1n << 128n,
      });

      const { executionResources, calculatedAmount } = pool.quote({
        specifiedAmount: 1n,
        isToken1: false,
      });

      expect(calculatedAmount).toEqual(0n);
      expect(executionResources.initializedTicksCrossed).toEqual(0);
      expect(executionResources.sqrtRatioAfter).toEqual(MIN_SQRT_RATIO);
    });

    it("works for 10000 liquidity 1000 token1 input", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 0,
        sortedTicks: [
          { tick: 0, liquidityDelta: 1000000000n },
          { tick: 1, liquidityDelta: -1000000000n },
        ],
        liquidity: 1000000000n,
        sqrtRatio: 1n << 128n,
      });

      const { executionResources, calculatedAmount } = pool.quote({
        specifiedAmount: 1000n,
        isToken1: true,
      });

      expect(calculatedAmount).toEqual(499n);
      expect(executionResources.initializedTicksCrossed).toEqual(1);
      expect(executionResources.sqrtRatioAfter).toEqual(MAX_SQRT_RATIO);
    });
    it("works for 10000 liquidity 1000 token1 input", () => {
      const pool = new PlainPool({
        fee: 0n,
        tick: 1,
        sortedTicks: [
          { tick: 0, liquidityDelta: 1000000000n },
          { tick: 1, liquidityDelta: -1000000000n },
        ],
        liquidity: 0n,
        sqrtRatio: toSqrtRatio(1),
      });

      const { executionResources, calculatedAmount } = pool.quote({
        specifiedAmount: 1000n,
        isToken1: false,
      });

      expect(calculatedAmount).toEqual(499n);
      expect(executionResources.initializedTicksCrossed).toEqual(2);
      expect(executionResources.sqrtRatioAfter).toEqual(MIN_SQRT_RATIO);
    });

    it.only("failing example", () => {
      const node = new PlainPool({
        fee: 1020847100762815411640772995208708096n,
        sqrtRatio: 15563001745813054266804011142814305n,
        tick: -19985280,
        sortedTicks: [
          { tick: -43058436, liquidityDelta: "6896952815" },
          { tick: -41455260, liquidityDelta: "3352933856364109" },
          { tick: -41449278, liquidityDelta: "-3352933856364109" },
          { tick: -39152190, liquidityDelta: "1060034353279" },
          { tick: -39146208, liquidityDelta: "-1043046221961" },
          { tick: -37537050, liquidityDelta: "120292523066347" },
          { tick: -37351608, liquidityDelta: "-120292523066347" },
          { tick: -36843138, liquidityDelta: "3208538392" },
          { tick: -34540068, liquidityDelta: "2501859512420" },
          { tick: -32242980, liquidityDelta: "66993828499244" },
          { tick: -32236998, liquidityDelta: "-68094263403972" },
          { tick: -31549068, liquidityDelta: "26044527670966" },
          { tick: -31543086, liquidityDelta: "-26044527670966" },
          { tick: -31142292, liquidityDelta: "52162370892824" },
          { tick: -31136310, liquidityDelta: "-52162370892824" },
          { tick: -30155262, liquidityDelta: "4833371383034" },
          { tick: -30053568, liquidityDelta: "9047048399" },
          { tick: -30041604, liquidityDelta: "-4833371383034" },
          { tick: -29939910, liquidityDelta: "467647896659234" },
          { tick: -29933928, liquidityDelta: "-467638048200443" },
          { tick: -29820270, liquidityDelta: "53311280614663" },
          { tick: -29754468, liquidityDelta: "13600627870" },
          { tick: -29748486, liquidityDelta: "-53311280614663" },
          { tick: -29245998, liquidityDelta: "224563934660361" },
          { tick: -29240016, liquidityDelta: "-224563934660361" },
          { tick: -29018682, liquidityDelta: "499574004481" },
          { tick: -28833240, liquidityDelta: "2506425496" },
          { tick: -28737528, liquidityDelta: "1741514948837997" },
          { tick: -28731546, liquidityDelta: "-1741514948837997" },
          { tick: -28426464, liquidityDelta: "225336135468560" },
          { tick: -28420482, liquidityDelta: "-225336135468560" },
          { tick: -28330752, liquidityDelta: "473669815258994" },
          { tick: -28324770, liquidityDelta: "-473649911335722" },
          { tick: -28037634, liquidityDelta: "167610347017" },
          { tick: -20225142, liquidityDelta: "-588153032353880" },
          { tick: -20213178, liquidityDelta: "410665542037683" },
          { tick: -20165322, liquidityDelta: "-393109696912163" },
          { tick: -20147376, liquidityDelta: "-131943367474773" },
          { tick: -27624876, liquidityDelta: "-333807226990762" },
          { tick: -27457380, liquidityDelta: "367287992789220" },
          { tick: -27451398, liquidityDelta: "-367287992789220" },
          { tick: -27224082, liquidityDelta: "68708790020" },
          { tick: -26936946, liquidityDelta: "-614086015786" },
          { tick: -26536152, liquidityDelta: "5793015907001" },
          { tick: -26530170, liquidityDelta: "-5793015907001" },
          { tick: -26021700, liquidityDelta: "207541311270" },
          { tick: -26003754, liquidityDelta: "130942688664" },
          { tick: -25949916, liquidityDelta: "409413556116" },
          { tick: -23383638, liquidityDelta: "43956590943870" },
          { tick: -23252034, liquidityDelta: "-43956590943870" },
          { tick: -22761510, liquidityDelta: "12534649315" },
          { tick: -22689726, liquidityDelta: "12370667010" },
          { tick: -22528212, liquidityDelta: "9047859950" },
          { tick: -21930012, liquidityDelta: "10203018113" },
          { tick: -21912066, liquidityDelta: "43472246222" },
          { tick: -21864210, liquidityDelta: "70849648133" },
          { tick: -21858228, liquidityDelta: "10425233990" },
          { tick: -21792426, liquidityDelta: "12498380831" },
          { tick: -21780462, liquidityDelta: "14343205689" },
          { tick: -21768498, liquidityDelta: "32210230722" },
          { tick: -21630912, liquidityDelta: "13229154682" },
          { tick: -21547164, liquidityDelta: "51255838424" },
          { tick: -21541182, liquidityDelta: "51421204552" },
          { tick: -21523236, liquidityDelta: "15811488410" },
          { tick: -21517254, liquidityDelta: "520834635436" },
          { tick: -21511272, liquidityDelta: "15317388059" },
          { tick: -21505290, liquidityDelta: "52447160042" },
          { tick: -21487344, liquidityDelta: "8840829275" },
          { tick: -21469398, liquidityDelta: "10155871628" },
          { tick: -21463416, liquidityDelta: "53641782635" },
          { tick: -21457434, liquidityDelta: "53830703475" },
          { tick: -21445470, liquidityDelta: "22818952388" },
          { tick: -21427524, liquidityDelta: "48629359688" },
          { tick: -21421542, liquidityDelta: "14898243985" },
          { tick: -21379668, liquidityDelta: "70849648868" },
          { tick: -21373686, liquidityDelta: "51020537238" },
          { tick: -21337794, liquidityDelta: "71395429280" },
          { tick: -21325830, liquidityDelta: "10331636888" },
          { tick: -21319848, liquidityDelta: "459049799872" },
          { tick: -21307884, liquidityDelta: "13852587334" },
          { tick: -21266010, liquidityDelta: "39780212232" },
          { tick: -21254046, liquidityDelta: "19164082833" },
          { tick: -21236100, liquidityDelta: "68693504680" },
          { tick: -21218154, liquidityDelta: "83082471025" },
          { tick: -21212172, liquidityDelta: "63731931265" },
          { tick: -21206190, liquidityDelta: "121563051454" },
          { tick: -21152352, liquidityDelta: "1022287258441" },
          { tick: -21098514, liquidityDelta: "22742022882" },
          { tick: -21080568, liquidityDelta: "642709944762" },
          { tick: -21056640, liquidityDelta: "72908073660" },
          { tick: -21032712, liquidityDelta: "11666960911" },
          { tick: -21026730, liquidityDelta: "225824226723" },
          { tick: -21008784, liquidityDelta: "273960691371" },
          { tick: -21002802, liquidityDelta: "35325020179" },
          { tick: -20948964, liquidityDelta: "94779928001" },
          { tick: -20841288, liquidityDelta: "20935955202583" },
          { tick: -20829324, liquidityDelta: "7645254177845" },
          { tick: -20727630, liquidityDelta: "31739554406232" },
          { tick: -20715666, liquidityDelta: "167933319705" },
          { tick: -20057646, liquidityDelta: "-145259052039875" },
          { tick: -20679774, liquidityDelta: "90619279" },
          { tick: -20673792, liquidityDelta: "47842482443439" },
          { tick: -20655846, liquidityDelta: "3993159608487" },
          { tick: -20649864, liquidityDelta: "47899961149985" },
          { tick: -20643882, liquidityDelta: "6668817290" },
          { tick: -20637900, liquidityDelta: "98737343997" },
          { tick: -20607990, liquidityDelta: "137993174821" },
          { tick: -20590044, liquidityDelta: "1832404103004" },
          { tick: -20584062, liquidityDelta: "8576399704436" },
          { tick: -20578080, liquidityDelta: "4873368473463" },
          { tick: -20560134, liquidityDelta: "1192143980595" },
          { tick: -20548170, liquidityDelta: "125656720638065" },
          { tick: -20536206, liquidityDelta: "100242175459519" },
          { tick: -20524242, liquidityDelta: "1180077982972" },
          { tick: -20512278, liquidityDelta: "34703274608160" },
          { tick: -20494332, liquidityDelta: "4450645450428" },
          { tick: -20476386, liquidityDelta: "208339037312993" },
          { tick: -19973898, liquidityDelta: "-118408478971602" },
          { tick: -20470404, liquidityDelta: "11323356684907" },
          { tick: -20452458, liquidityDelta: "114409015650033" },
          { tick: -20446476, liquidityDelta: "49756883325" },
          { tick: -20440494, liquidityDelta: "79746627198526" },
          { tick: -20434512, liquidityDelta: "104998118653760" },
          { tick: -20428530, liquidityDelta: "3842720641877" },
          { tick: -19914078, liquidityDelta: "-45448528179991" },
          { tick: -20314872, liquidityDelta: "694748864904503" },
          { tick: -20308890, liquidityDelta: "97764119779844" },
          { tick: -20027736, liquidityDelta: "-260036165247669" },
          { tick: -20386656, liquidityDelta: "468843704545748" },
          { tick: -19955952, liquidityDelta: "-77218525086579" },
          { tick: -20045682, liquidityDelta: "-1870639044618" },
          { tick: -20039700, liquidityDelta: "-893869869022" },
          { tick: -19938006, liquidityDelta: "-52022937618" },
          { tick: -19908096, liquidityDelta: "-24123773053" },
          { tick: -19902114, liquidityDelta: "-110779768092" },
          { tick: -19896132, liquidityDelta: "12809586392559" },
          { tick: -19890150, liquidityDelta: "-17564899788083" },
          { tick: -19878186, liquidityDelta: "-1291826510961" },
          { tick: -19854258, liquidityDelta: "-173873927603875" },
          { tick: -19842294, liquidityDelta: "-6670332014" },
          { tick: -19830330, liquidityDelta: "-177829874635" },
          { tick: -19824348, liquidityDelta: "-611722616574" },
          { tick: -19812384, liquidityDelta: "23375386143104" },
          { tick: -19800420, liquidityDelta: "-6698687586105" },
          { tick: -19794438, liquidityDelta: "-68693504680" },
          { tick: -19782474, liquidityDelta: "-88564966206" },
          { tick: -19776492, liquidityDelta: "175957704865" },
          { tick: -19764528, liquidityDelta: "-17049968350288" },
          { tick: -19752564, liquidityDelta: "-47012706131" },
          { tick: -19740600, liquidityDelta: "-4202742407458" },
          { tick: -19734618, liquidityDelta: "17358708971519" },
          { tick: -19728636, liquidityDelta: "-17360441818752" },
          { tick: -19692744, liquidityDelta: "-1372322390584" },
          { tick: -19680780, liquidityDelta: "-285191962055" },
          { tick: -19662834, liquidityDelta: "-10594424258569" },
          { tick: -19656852, liquidityDelta: "-6040014435581" },
          { tick: -19644888, liquidityDelta: "-58945160772" },
          { tick: -19638906, liquidityDelta: "-7084004384789" },
          { tick: -19608996, liquidityDelta: "-3124426224004" },
          { tick: -19603014, liquidityDelta: "-5970553379138" },
          { tick: -19597032, liquidityDelta: "-3102899586333" },
          { tick: -19591050, liquidityDelta: "-662524517417" },
          { tick: -19531230, liquidityDelta: "3435165852383" },
          { tick: -20410584, liquidityDelta: "81109123889229" },
          { tick: -20398620, liquidityDelta: "575385243640906" },
          { tick: -19465428, liquidityDelta: "-11880194060959" },
          { tick: -19453464, liquidityDelta: "-12156513682770" },
          { tick: -19447482, liquidityDelta: "-1832404103004" },
          { tick: -19441500, liquidityDelta: "-4684561926847" },
          { tick: -20374692, liquidityDelta: "489704023566821" },
          { tick: -20368710, liquidityDelta: "241591869531203" },
          { tick: -20362728, liquidityDelta: "364188464322766" },
          { tick: -20356746, liquidityDelta: "485430257381128" },
          { tick: -19393644, liquidityDelta: "-132443123685" },
          { tick: -20350764, liquidityDelta: "4433834247341527" },
          { tick: -19369716, liquidityDelta: "-8281899336654" },
          { tick: -20338800, liquidityDelta: "1207050324281767" },
          { tick: -20332818, liquidityDelta: "2646695449634794" },
          { tick: -19363734, liquidityDelta: "-96932382880" },
          { tick: -20326836, liquidityDelta: "6475767853929939" },
          { tick: -20320854, liquidityDelta: "1906599707160487" },
          { tick: -20302908, liquidityDelta: "63720440104706" },
          { tick: -19214184, liquidityDelta: "-8980265773009" },
          { tick: -19208202, liquidityDelta: "-18316291160" },
          { tick: -19136418, liquidityDelta: "-187692104694" },
          { tick: -19106508, liquidityDelta: "-4501573382011" },
          { tick: -19022760, liquidityDelta: "-86178335513" },
          { tick: -18962940, liquidityDelta: "-43120690911" },
          { tick: -18950976, liquidityDelta: "-44059031852" },
          { tick: -18873210, liquidityDelta: "4195134449702" },
          { tick: -18807408, liquidityDelta: "-18037292270" },
          { tick: -18789462, liquidityDelta: "-18636018713" },
          { tick: -18759552, liquidityDelta: "-17442563205" },
          { tick: -18729642, liquidityDelta: "-11666960911" },
          { tick: -18681786, liquidityDelta: "-8840829275" },
          { tick: -18657858, liquidityDelta: "-36391520824" },
          { tick: -18633930, liquidityDelta: "-22742022882" },
          { tick: -18586074, liquidityDelta: "-7454407485" },
          { tick: -18580092, liquidityDelta: "-10203018113" },
          { tick: -18574110, liquidityDelta: "-15317388059" },
          { tick: -18562146, liquidityDelta: "-27994701197" },
          { tick: -18538218, liquidityDelta: "-24029855818" },
          { tick: -18526254, liquidityDelta: "-13988334024" },
          { tick: -18514290, liquidityDelta: "-39780212232" },
          { tick: -18490362, liquidityDelta: "-13229154682" },
          { tick: -18460452, liquidityDelta: "-840393873" },
          { tick: -18448488, liquidityDelta: "-90619279" },
          { tick: -18442506, liquidityDelta: "-695421284" },
          { tick: -20261034, liquidityDelta: "362958696035425" },
          { tick: -18418578, liquidityDelta: "2537531407457" },
          { tick: -18412596, liquidityDelta: "-3351905253181" },
          { tick: -18316884, liquidityDelta: "-6668817290" },
          { tick: -18233136, liquidityDelta: "-13250446358" },
          { tick: -18149388, liquidityDelta: "-9047048399" },
          { tick: -18083586, liquidityDelta: "-10425233990" },
          { tick: -18035730, liquidityDelta: "10750712834" },
          { tick: -18017784, liquidityDelta: "-10834604807" },
          { tick: -17904126, liquidityDelta: "-9047859950" },
          { tick: -17892162, liquidityDelta: "-19761665575" },
          { tick: -17832342, liquidityDelta: "-10155871628" },
          { tick: -17796450, liquidityDelta: "-10750712834" },
          { tick: -17778504, liquidityDelta: "-14343205689" },
          { tick: -17736630, liquidityDelta: "-17287727909" },
          { tick: -17724666, liquidityDelta: "-129186371705" },
          { tick: -17090574, liquidityDelta: "-33032390407" },
          { tick: -16127472, liquidityDelta: "-12219516339" },
          { tick: -16115508, liquidityDelta: "-34550169033" },
          { tick: -20255052, liquidityDelta: "1830093392063465" },
          { tick: -15583110, liquidityDelta: "-14898243985" },
          { tick: -15475434, liquidityDelta: "-14198425339" },
          { tick: -15415614, liquidityDelta: "-124949865" },
          { tick: -11515350, liquidityDelta: "-434534950831" },
          { tick: -20249070, liquidityDelta: "195079514253150" },
          { tick: -20243088, liquidityDelta: "108003515808077" },
          { tick: -20207196, liquidityDelta: "-319371656471836" },
          { tick: -20195232, liquidityDelta: "-147017384543814" },
          { tick: -20189250, liquidityDelta: "-67060531610571" },
          { tick: -20171304, liquidityDelta: "-111294922560217" },
          { tick: -20135412, liquidityDelta: "-630255928614633" },
          { tick: -20129430, liquidityDelta: "-294640651482138" },
          { tick: -20123448, liquidityDelta: "-361262865236242" },
          { tick: -20117466, liquidityDelta: "-452012044138012" },
          { tick: -20111484, liquidityDelta: "-4415107665045177" },
          { tick: -20099520, liquidityDelta: "-1057100005109185" },
          { tick: -20093538, liquidityDelta: "-2812419504032366" },
          { tick: -20087556, liquidityDelta: "-6084177470294622" },
          { tick: -20081574, liquidityDelta: "-2546479093100808" },
          { tick: -20063628, liquidityDelta: "-40209366741372" },
          { tick: -20033718, liquidityDelta: "-8021014147311" },
          { tick: -20015772, liquidityDelta: "-1009756049877202" },
          { tick: -20009790, liquidityDelta: "-162837632816018" },
          { tick: -20003808, liquidityDelta: "-182653404149054" },
          { tick: -19979880, liquidityDelta: "-161576954484401" },
          { tick: -19967916, liquidityDelta: "-376694484637826" },
          { tick: -19949970, liquidityDelta: "-14966499961026" },
          { tick: -19872204, liquidityDelta: "-24560253792094" },
          { tick: -19860240, liquidityDelta: "-353193742217869" },
          { tick: -19848276, liquidityDelta: "-364396442360706" },
          { tick: -20380674, liquidityDelta: "702127039281324" },
          { tick: -20141394, liquidityDelta: "-692372577608127" },
          { tick: 20087556, liquidityDelta: "2040795524385285087" },
          { tick: 20326836, liquidityDelta: "-2040795524385285087" },
          { tick: -20105502, liquidityDelta: "-1675649798191306" },
          { tick: -19866222, liquidityDelta: "-2765641552156" },
          { tick: -20554152, liquidityDelta: "52658688463146" },
          { tick: -20518260, liquidityDelta: "87138481224437" },
          { tick: 88719042, liquidityDelta: "-10553216920139" },
          { tick: -88719042, liquidityDelta: "11729508586897" },
          { tick: -33846156, liquidityDelta: "3674516776725" },
          { tick: -27750498, liquidityDelta: "6770166518408033" },
          { tick: -19525248, liquidityDelta: "-16007616393751" },
          { tick: -27636840, liquidityDelta: "997750394211138" },
          { tick: -20972892, liquidityDelta: "9250371148752" },
          { tick: -20566116, liquidityDelta: "546447009134" },
          { tick: -27630858, liquidityDelta: "-664850411169272" },
          { tick: -27511218, liquidityDelta: "-6771621085306797" },
          { tick: -26243034, liquidityDelta: "-3674516776725" },
          { tick: -21415560, liquidityDelta: "139359362491" },
          { tick: -20721648, liquidityDelta: "53221888622185" },
          { tick: -20625936, liquidityDelta: "14268823223026" },
          { tick: -20619954, liquidityDelta: "63438716574146" },
          { tick: -20542188, liquidityDelta: "68347033104134" },
          { tick: -20500314, liquidityDelta: "17709398232952" },
          { tick: -20482368, liquidityDelta: "13378468599020" },
          { tick: -20458440, liquidityDelta: "327273812517940" },
          { tick: -20422548, liquidityDelta: "1931184196766" },
          { tick: -20416566, liquidityDelta: "-19708014356970" },
          { tick: -20404602, liquidityDelta: "133842300082579" },
          { tick: -20392638, liquidityDelta: "242919689814208" },
          { tick: -20344782, liquidityDelta: "920462051765137" },
          { tick: -20296926, liquidityDelta: "402194082106762" },
          { tick: -20290944, liquidityDelta: "137048493643935" },
          { tick: -20284962, liquidityDelta: "733546876922176" },
          { tick: -20278980, liquidityDelta: "123680061209562" },
          { tick: -20272998, liquidityDelta: "69041423108817" },
          { tick: -20267016, liquidityDelta: "247161517331367" },
          { tick: -20237106, liquidityDelta: "175997855611794" },
          { tick: -20231124, liquidityDelta: "1140305715624951" },
          { tick: -20219160, liquidityDelta: "-144892487523091" },
          { tick: -20201214, liquidityDelta: "-257912081118844" },
          { tick: -20183268, liquidityDelta: "-108825266583390" },
          { tick: -20177286, liquidityDelta: "-48399236175472" },
          { tick: -20159340, liquidityDelta: "-318273164950904" },
          { tick: -20153358, liquidityDelta: "-291191457251910" },
          { tick: -20075592, liquidityDelta: "-193126551496805" },
          { tick: -20069610, liquidityDelta: "-57712455322" },
          { tick: -20051664, liquidityDelta: "-47712772828408" },
          { tick: -20021754, liquidityDelta: "-475551041391763" },
          { tick: -19997826, liquidityDelta: "-183356011952224" },
          { tick: -19991844, liquidityDelta: "-144529123061283" },
          { tick: -19985862, liquidityDelta: "-339316483046009" },
          { tick: -19961934, liquidityDelta: "-107784813623896" },
          { tick: -19932024, liquidityDelta: "-447460390365490" },
          { tick: -19926042, liquidityDelta: "-64466812031283" },
          { tick: -19920060, liquidityDelta: "-83095322598448" },
          { tick: -19884168, liquidityDelta: "-6209819519553" },
          { tick: -19818366, liquidityDelta: "-8763574035894" },
          { tick: -19806402, liquidityDelta: "-17566680572387" },
          { tick: -19788456, liquidityDelta: "-14390139766101" },
          { tick: -19770510, liquidityDelta: "12750268060247" },
          { tick: -19668816, liquidityDelta: "-19890239686705" },
          { tick: -19626942, liquidityDelta: "-12922143156181" },
          { tick: -19585068, liquidityDelta: "11004376023849" },
          { tick: -19471410, liquidityDelta: "3770372736521" },
          { tick: -19339806, liquidityDelta: "-2276719198140" },
          { tick: -19220166, liquidityDelta: "-55501931529020" },
          { tick: -19112490, liquidityDelta: "-23161810068474" },
          { tick: -18933030, liquidityDelta: "-44298158633" },
          { tick: -18867228, liquidityDelta: "-4195134449702" },
          { tick: -18849282, liquidityDelta: "-11015522391348" },
          { tick: -18777498, liquidityDelta: "-37063887018" },
          { tick: -18645894, liquidityDelta: "-7243067296517" },
        ]
          .sort(({ tick: t1 }, { tick: t2 }) => t1 - t2)
          .map(({ tick, liquidityDelta }) => ({
            tick,
            liquidityDelta: BigInt(liquidityDelta),
          })),
        liquidity: 2695287607686846n,
      });

      expect(node.quote({ specifiedAmount: 2000_000_000n, isToken1: true }))
        .toMatchInlineSnapshot(`
{
  "calculatedAmount": 936436900591253065n,
  "consumedAmount": 2000000000n,
  "executionResources": {
    "initializedTicksCrossed": 6,
    "sqrtRatioAfter": 15872291964112534506739284504875310n,
  },
}
`);

      expect(node.quote({ specifiedAmount: 20_000_000_000n, isToken1: true }))
        .toMatchInlineSnapshot(`
{
  "calculatedAmount": 3452816583777024873n,
  "consumedAmount": 20000000000n,
  "executionResources": {
    "initializedTicksCrossed": 117,
    "sqrtRatioAfter": 377134351309606061799205432664099065n,
  },
}
`);

      expect(node.quote({ specifiedAmount: 10n ** 18n, isToken1: false }))
        .toMatchInlineSnapshot(`
{
  "calculatedAmount": 2056726308n,
  "consumedAmount": 1000000000000000000n,
  "executionResources": {
    "initializedTicksCrossed": 5,
    "sqrtRatioAfter": 15351645511658427122522343665007033n,
  },
}
`);

      expect(node.quote({ specifiedAmount: 10n ** 19n, isToken1: false }))
        .toMatchInlineSnapshot(`
{
  "calculatedAmount": 19235712200n,
  "consumedAmount": 10000000000000000000n,
  "executionResources": {
    "initializedTicksCrossed": 21,
    "sqrtRatioAfter": 14632289607269626372995305978535074n,
  },
}
`);
    });
  });
});
