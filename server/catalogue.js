export const SKINS = [
  {
    id: 'kairo_neon_ember',
    heroId: 'kairo',
    heroName: 'Кайро',
    name: 'Неоновое Пламя',
    rarity: 'rare',
    price: 120,
    color: 0xff3b2f,
    accent: 0x2fffe6,
    description: 'Огненные перчатки с бирюзовым неоновым следом.'
  },
  {
    id: 'kairo_solar_ronin',
    heroId: 'kairo',
    heroName: 'Кайро',
    name: 'Солнечный Ронин',
    rarity: 'epic',
    price: 260,
    color: 0xffb13b,
    accent: 0xfff1a8,
    description: 'Золотой боевой костюм для ярких all-in атак.'
  },
  {
    id: 'reyna_starfall',
    heroId: 'reyna',
    heroName: 'Рэйна',
    name: 'Звёздный Падший Клинок',
    rarity: 'rare',
    price: 120,
    color: 0x6d8cff,
    accent: 0xf1f7ff,
    description: 'Холодное сияние звёздного клинка и серебряные рывки.'
  },
  {
    id: 'reyna_crimson_moon',
    heroId: 'reyna',
    heroName: 'Рэйна',
    name: 'Багровая Луна',
    rarity: 'epic',
    price: 260,
    color: 0xc72064,
    accent: 0xffd1e5,
    description: 'Контрастный assassin-образ с красно-лунными следами.'
  },
  {
    id: 'teo_arc_blue',
    heroId: 'teo',
    heroName: 'Тэо',
    name: 'Синий Разряд',
    rarity: 'rare',
    price: 120,
    color: 0x247cff,
    accent: 0x8ff7ff,
    description: 'Усиленные конденсаторы и чистые электрические VFX.'
  },
  {
    id: 'teo_storm_gold',
    heroId: 'teo',
    heroName: 'Тэо',
    name: 'Золотой Шторм',
    rarity: 'epic',
    price: 260,
    color: 0x7e55ff,
    accent: 0xffdf6e,
    description: 'Редкий костюм громового тактика с золотыми печатями.'
  }
];

export function getSkinById(skinId) {
  return SKINS.find((skin) => skin.id === skinId) ?? null;
}

export function skinsForHero(heroId) {
  return SKINS.filter((skin) => skin.heroId === heroId);
}
