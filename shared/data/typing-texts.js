/**
 * 타이핑 레이스 지문.
 *
 * Short enough to finish in well under two minutes, long enough that accuracy
 * decides the race rather than a lucky burst.
 */

export const TEXTS = [
  {
    id: 'ko-hangul',
    lang: 'ko',
    title: '한글',
    body:
      '나라의 말이 중국과 달라 한자와 서로 통하지 아니하므로 어리석은 백성이 말하고자 하는 바가 있어도 마침내 제 뜻을 펴지 못하는 사람이 많다. 내가 이를 딱하게 여겨 새로 스물여덟 글자를 만드니 사람마다 쉽게 익혀 날마다 쓰기에 편하게 하고자 할 따름이다.',
  },
  {
    id: 'ko-sea',
    lang: 'ko',
    title: '바다',
    body:
      '아침 바다는 언제나 조용하다. 물결이 모래를 한 번 쓸고 지나가면 어제의 발자국은 남김없이 사라진다. 갈매기 몇 마리가 낮게 날고, 멀리서 배 한 척이 천천히 수평선을 건너간다. 바다는 아무것도 기억하지 않지만 매일 같은 자리에서 우리를 기다린다.',
  },
  {
    id: 'ko-code',
    lang: 'ko',
    title: '코드',
    body:
      '좋은 코드는 설명이 필요 없다는 말은 절반만 맞다. 이름을 잘 짓고 구조를 단순하게 만들면 대부분의 설명은 사라지지만, 왜 그렇게 했는지는 코드에 남지 않는다. 그래서 주석은 무엇을 하는지가 아니라 왜 하는지를 적어야 한다.',
  },
  {
    id: 'ko-winter',
    lang: 'ko',
    title: '겨울 아침',
    body:
      '눈이 내린 다음 날 아침은 유난히 밝다. 아무도 밟지 않은 길 위로 첫 발자국을 남기는 일은 언제나 조금 미안하고 조금 즐겁다. 담장 위의 눈은 오후가 되면 녹아 사라지지만, 그 짧은 시간 동안 온 동네가 조용해진다.',
  },
  {
    id: 'en-fox',
    lang: 'en',
    title: 'Pangram',
    body:
      'The quick brown fox jumps over the lazy dog. Pack my box with five dozen liquor jugs. How vexingly quick daft zebras jump! Sphinx of black quartz, judge my vow. Bright vixens jump; dozy fowl quack.',
  },
  {
    id: 'en-code',
    lang: 'en',
    title: 'Craft',
    body:
      'Programs must be written for people to read, and only incidentally for machines to execute. Simplicity is a great virtue but it requires hard work to achieve it, and education to appreciate it. Make it work, make it right, make it fast.',
  },
];

export function textById(id) {
  return TEXTS.find((t) => t.id === id) || TEXTS[0];
}
