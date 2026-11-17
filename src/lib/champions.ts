// Riot Data Dragon CDN 기반 챔피언 아이콘
const DDRAGON_VERSION = "16.13.1";
const DDRAGON_BASE = `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}`;

// 한글 이름 → 영문 key 매핑 (Data Dragon 이미지 경로용)
const KO_TO_KEY: Record<string, string> = {
  "아트록스": "Aatrox", "아리": "Ahri", "아칼리": "Akali", "아크샨": "Akshan",
  "알리스타": "Alistar", "암베사": "Ambessa", "아무무": "Amumu", "애니비아": "Anivia",
  "애니": "Annie", "아펠리오스": "Aphelios", "애쉬": "Ashe", "아우렐리온 솔": "AurelionSol",
  "오로라": "Aurora", "아지르": "Azir", "바드": "Bard", "벨베스": "Belveth",
  "블리츠크랭크": "Blitzcrank", "브랜드": "Brand", "브라움": "Braum", "브라이어": "Briar",
  "케이틀린": "Caitlyn", "카밀": "Camille", "카시오페아": "Cassiopeia", "초가스": "Chogath",
  "코르키": "Corki", "다리우스": "Darius", "다이애나": "Diana", "드레이븐": "Draven",
  "문도 박사": "DrMundo", "에코": "Ekko", "엘리스": "Elise", "이블린": "Evelynn",
  "이즈리얼": "Ezreal", "피들스틱": "Fiddlesticks", "피오라": "Fiora", "피즈": "Fizz",
  "갈리오": "Galio", "갱플랭크": "Gangplank", "가렌": "Garen", "나르": "Gnar",
  "그라가스": "Gragas", "그레이브즈": "Graves", "그웬": "Gwen", "헤카림": "Hecarim",
  "하이머딩거": "Heimerdinger", "흐웨이": "Hwei", "일라오이": "Illaoi", "이렐리아": "Irelia",
  "아이번": "Ivern", "잔나": "Janna", "자르반 4세": "JarvanIV", "잭스": "Jax",
  "제이스": "Jayce", "진": "Jhin", "징크스": "Jinx", "카이사": "Kaisa",
  "칼리스타": "Kalista", "카르마": "Karma", "카서스": "Karthus", "카사딘": "Kassadin",
  "카타리나": "Katarina", "케일": "Kayle", "케인": "Kayn", "케넨": "Kennen",
  "카직스": "Khazix", "킨드레드": "Kindred", "클레드": "Kled", "코그모": "KogMaw",
  "크산테": "KSante", "르블랑": "Leblanc", "리 신": "LeeSin", "레오나": "Leona",
  "릴리아": "Lillia", "리산드라": "Lissandra", "로크": "Locke", "루시안": "Lucian",
  "룰루": "Lulu", "럭스": "Lux", "말파이트": "Malphite", "말자하": "Malzahar",
  "마오카이": "Maokai", "마스터 이": "MasterYi", "멜": "Mel", "밀리오": "Milio",
  "미스 포츈": "MissFortune", "오공": "MonkeyKing", "모데카이저": "Mordekaiser",
  "모르가나": "Morgana", "나피리": "Naafiri", "나미": "Nami", "나서스": "Nasus",
  "노틸러스": "Nautilus", "니코": "Neeko", "니달리": "Nidalee", "닐라": "Nilah",
  "녹턴": "Nocturne", "누누와 윌럼프": "Nunu", "올라프": "Olaf", "오리아나": "Orianna",
  "오른": "Ornn", "판테온": "Pantheon", "뽀삐": "Poppy", "파이크": "Pyke",
  "키아나": "Qiyana", "퀸": "Quinn", "라칸": "Rakan", "람머스": "Rammus",
  "렉사이": "RekSai", "렐": "Rell", "레나타 글라스크": "Renata", "레넥톤": "Renekton",
  "렝가": "Rengar", "리븐": "Riven", "럼블": "Rumble", "라이즈": "Ryze",
  "사미라": "Samira", "세주아니": "Sejuani", "세나": "Senna", "세라핀": "Seraphine",
  "세트": "Sett", "샤코": "Shaco", "쉔": "Shen", "시바나": "Shyvana",
  "신지드": "Singed", "사이온": "Sion", "시비르": "Sivir", "스카너": "Skarner",
  "스몰더": "Smolder", "소나": "Sona", "소라카": "Soraka", "스웨인": "Swain",
  "사일러스": "Sylas", "신드라": "Syndra", "탐 켄치": "TahmKench", "탈리야": "Taliyah",
  "탈론": "Talon", "타릭": "Taric", "티모": "Teemo", "쓰레쉬": "Thresh",
  "트리스타나": "Tristana", "트런들": "Trundle", "트린다미어": "Tryndamere",
  "트위스티드 페이트": "TwistedFate", "트위치": "Twitch", "우디르": "Udyr",
  "우르곳": "Urgot", "바루스": "Varus", "베인": "Vayne", "베이가": "Veigar",
  "벨코즈": "Velkoz", "비에고": "Viego", "바이": "Vi", "빅토르": "Viktor",
  "블라디미르": "Vladimir", "볼리베어": "Volibear", "워윅": "Warwick", "자야": "Xayah",
  "제라스": "Xerath", "신 짜오": "XinZhao", "야스오": "Yasuo", "요네": "Yone",
  "요릭": "Yorick", "유미": "Yuumi", "자크": "Zac", "제드": "Zed",
  "제리": "Zeri", "직스": "Ziggs", "질리언": "Zilean", "조이": "Zoe", "자이라": "Zyra",
  // 누누 별명
  "누누": "Nunu",
  // 누락분 + 신규 챔피언
  "벡스": "Vex",
  "유나라": "Yunara",
  "자헨": "Zaahen",
};

// 영문 key → 한글 이름 (역방향, 별명보다 정식 이름 우선)
const KEY_TO_KO: Record<string, string> = {};
for (const [ko, key] of Object.entries(KO_TO_KEY)) {
  if (!(key in KEY_TO_KO)) KEY_TO_KO[key] = ko;
}

/** 챔피언 이름을 한글로 정규화. 수집기가 올리는 영문 이름(Aatrox, MonkeyKing 등)을
 * 한글로 바꿔서 표시·집계가 "아트록스"/"Aatrox"로 갈라지지 않게 함.
 * 매핑에 없는 이름(최신 챔피언 등)은 그대로 반환. */
export function normalizeChampionName(name: string): string {
  if (!name) return name;
  if (KO_TO_KEY[name]) return name; // 이미 한글 정식 이름
  return KEY_TO_KO[name] || KEY_TO_KO[name.replace(/\s/g, "")] || name;
}

export function getChampionIconUrl(championName: string): string | null {
  // 1. 한글 이름으로 매핑 시도
  let key = KO_TO_KEY[championName];

  // 2. 영문 이름이면 그대로 사용
  if (!key && /^[A-Za-z]/.test(championName)) {
    key = championName.replace(/\s/g, "");
  }

  if (!key) return null;

  return `${DDRAGON_BASE}/img/champion/${key}.png`;
}

export function getChampionKey(championName: string): string | null {
  return KO_TO_KEY[championName] || (/^[A-Za-z]/.test(championName) ? championName.replace(/\s/g, "") : null);
}
