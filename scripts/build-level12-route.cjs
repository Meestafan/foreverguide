const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const quests = JSON.parse(fs.readFileSync(path.join(root, 'quest_catalog.json'), 'utf8')).quests;
const dungeons = JSON.parse(fs.readFileSync(path.join(root, 'dungeon_quest_db.json'), 'utf8'));
const xpLevels = JSON.parse(fs.readFileSync(path.join(root, 'xp_per_level.json'), 'utf8')).levels;
const xpAtLevel = new Map(xpLevels.map((entry) => [entry.level, entry.totalXp]));
const questById = new Map(quests.map((quest) => [quest.questId, quest]));
const dungeonOrder = [
  'The Hall of Thanes', 'Deadmines', 'Ruins of Lordaeron', 'Wailing Caverns',
  'Stockades', 'Blackfathom Deeps', 'Gnomeregan', 'Razorfen Downs', 'Uldaman',
  "Zul'Farrak", 'Maraudon', 'Sunken Temple', 'Blackrock Depths', 'Dire Maul',
  'Stratholme', 'Scholomance',
];
const MAX_WORLD_QUESTS_PER_LEVEL = 8;

const zoneOrderByBand = [
  { max: 14, zones: ['Stormwind City', 'Westfall', 'Elwynn Forest', 'Dun Morogh', 'Ironforge', 'Loch Modan', 'Redridge Mountains'] },
  { max: 19, zones: ['Westfall', 'Redridge Mountains', 'Duskwood', 'Loch Modan', 'Wetlands', 'Hillsbrad Foothills', 'Darkshore', 'Ashenvale', 'The Barrens'] },
  { max: 24, zones: ['Darkshore', 'Ashenvale', 'The Barrens', 'Stonetalon Mountains', 'Wetlands', 'Duskwood', 'Stormwind City'] },
  { max: 29, zones: ['The Barrens', 'Stonetalon Mountains', 'Ashenvale', 'Thousand Needles', 'Hillsbrad Foothills', 'Stranglethorn Vale', 'Duskwood', 'Ironforge'] },
  { max: 34, zones: ['Hillsbrad Foothills', 'Arathi Highlands', 'Desolace', 'Thousand Needles', 'Dustwallow Marsh', 'Ashenvale'] },
  { max: 39, zones: ['Stranglethorn Vale', 'Dustwallow Marsh', 'Desolace', 'Arathi Highlands', 'Badlands', 'Thousand Needles', 'Feralas'] },
  { max: 44, zones: ['Badlands', 'The Hinterlands', 'Tanaris', 'Feralas', 'Dustwallow Marsh', 'Stranglethorn Vale', 'Searing Gorge'] },
  { max: 49, zones: ['Feralas', 'Tanaris', 'The Hinterlands', 'Stranglethorn Vale', 'Searing Gorge', 'Desolace', 'Swamp Of Sorrows'] },
  { max: 54, zones: ['Swamp Of Sorrows', 'Searing Gorge', 'Feralas', 'Felwood', 'Winterspring', 'Azshara', 'Un Goro Crater', 'Western Plaguelands', 'Burning Steppes'] },
  { max: 60, zones: ['Eastern Plaguelands', 'Western Plaguelands', 'Felwood', 'Silithus', 'Winterspring', 'Burning Steppes', 'Tanaris', 'Un Goro Crater'] },
];

const flightPathNotes = {
  'Stormwind City': 'Starting assumption: begin in Stormwind. Use the city flight path for later hub returns.',
  'Westfall': 'Pick up the Sentinel Hill flight path while completing the local hub loop.',
  'Redridge Mountains': 'Pick up the Lakeshire flight path before leaving Redridge.',
  'Duskwood': 'Pick up the Darkshire flight path while in town.',
  'Dun Morogh': 'Use Ironforge as the return hub; collect its flight path if not already known.',
  'Ironforge': 'Collect or confirm the Ironforge flight path before leaving the city.',
  'Loch Modan': 'Pick up the Thelsamar flight path while passing through.',
  'Wetlands': 'Pick up Menethil Harbor flight path before taking the boat to Kalimdor.',
  'Darkshore': 'Pick up the Auberdine flight path on arrival.',
  'Ashenvale': 'Pick up the Astranaar flight path while collecting the local quests.',
  'The Barrens': 'Pick up Crossroads and Ratchet flight paths where accessible; complete Wailing Caverns and Razorfen Downs on the Kalimdor leg.',
  'Stonetalon Mountains': 'Pick up Sun Rock Retreat flight path if accessible to your character.',
  'Hillsbrad Foothills': 'Pick up Southshore flight path before continuing north.',
  'Arathi Highlands': 'Pick up Refuge Pointe flight path while in the zone.',
  'Stranglethorn Vale': 'Pick up Booty Bay flight path; use the coastal boat links to avoid retracing the road.',
  'Desolace': 'Pick up Nijel\'s Point flight path before the Maraudon visit.',
  'Thousand Needles': 'Pick up the local flight path when passing through.',
  'Dustwallow Marsh': 'Pick up Theramore flight path before leaving the marsh.',
  'Feralas': 'Pick up Feathermoon Stronghold flight path; pair it with Dire Maul.',
  'Tanaris': 'Pick up Gadgetzan flight path; pair the stop with Zul\'Farrak.',
  'Badlands': 'Pick up the nearest usable flight path before Uldaman.',
  'The Hinterlands': 'Pick up Aerie Peak flight path if available to your faction.',
  'Searing Gorge': 'Pick up Thorium Point flight path before Blackrock Depths.',
  'Swamp Of Sorrows': 'Pick up the nearest usable flight path before Sunken Temple.',
  'Un Goro Crater': 'Use the Un\'Goro flight path if already unlocked; otherwise travel in from Gadgetzan.',
  'Felwood': 'Pick up Emerald Sanctuary flight path while passing through.',
  'Azshara': 'Pick up Talrendis Point flight path if available.',
  'Western Plaguelands': 'Pick up Chillwind Camp flight path before the Scholomance loop.',
  'Eastern Plaguelands': 'Pick up Light\'s Hope Chapel flight path; pair it with Stratholme.',
  'Burning Steppes': 'Pick up Morgan\'s Vigil flight path if available.',
  'Silithus': 'Pick up Cenarion Hold flight path for the final southern Kalimdor sweep.',
  'Winterspring': 'Pick up Everlook flight path if available.',
};

const dungeonNotes = {
  'The Hall of Thanes': 'Collect all listed dungeon quests before entering. The route assumes the Ironforge-side entrance.',
  'Ruins of Lordaeron': 'Remote faction-specific detour. Confirm access and collect all four Alliance quests before entering.',
  'Wailing Caverns': 'Collect all four Alliance-eligible quests together in the Barrens, then complete one instance visit.',
  'Deadmines': 'Collect the Westfall quest chain before entering from Moonbrook.',
  'Blackfathom Deeps': 'Collect the Ashenvale/Alliance quests together before the single dungeon visit.',
  'Stockades': 'Collect all Stormwind dungeon quests before the single city instance visit.',
  'Gnomeregan': 'Collect the Ironforge-side quest set before entering; use the Dun Morogh/Ironforge flight path.',
  'Razorfen Downs': 'Collect all four eligible quests during the Barrens leg before entering.',
  'Uldaman': 'Collect the Badlands and Ironforge quest leads before entering from the Badlands side.',
  "Zul'Farrak": 'Collect all Tanaris quest leads before the single Zul\'Farrak visit.',
  'Maraudon': 'Collect the Desolace quest set before entering from Nijel\'s Point.',
  'Sunken Temple': 'Collect the Swamp of Sorrows quest leads before the single Temple visit.',
  'Blackrock Depths': 'Collect the Searing Gorge/Blackrock quest leads before entering.',
  'Dire Maul': 'Collect the Feralas quest set before the single Dire Maul visit.',
  'Stratholme': 'Collect the Eastern Plaguelands quest set before the single Stratholme visit.',
  'Scholomance': 'Collect the Western Plaguelands quest set before the single Scholomance visit.',
};
const dungeonHubs = {
  'The Hall of Thanes': 'Ironforge',
  'Ruins of Lordaeron': 'Tirisfal Glades',
  'Wailing Caverns': 'The Barrens',
  'Deadmines': 'Westfall',
  'Blackfathom Deeps': 'Ashenvale',
  'Stockades': 'Stormwind City',
  'Gnomeregan': 'Ironforge',
  'Razorfen Downs': 'The Barrens',
  'Uldaman': 'Badlands',
  "Zul'Farrak": 'Tanaris',
  'Maraudon': 'Desolace',
  'Sunken Temple': 'Swamp Of Sorrows',
  'Blackrock Depths': 'Searing Gorge',
  'Dire Maul': 'Feralas',
  'Stratholme': 'Eastern Plaguelands',
  'Scholomance': 'Western Plaguelands',
};

function questRequiredLevel(quest) {
  return Math.max(1, Number(quest?.requiredLevel) || Number(quest?.required) || Number(quest?.questLevel) || 1);
}

function starterZone(quest) {
  const locations = [...(quest.starters?.npcs || []), ...(quest.starters?.objects || [])];
  for (const location of locations) {
    const zone = (location.zones || []).find((entry) => entry.zone)?.zone;
    if (zone) return zone;
  }
  return quest.zone || null;
}

function firstStarterPoint(quest) {
  const locations = [...(quest.starters?.npcs || []), ...(quest.starters?.objects || [])];
  for (const location of locations) {
    for (const zone of location.zones || []) {
      const point = zone.coordinates?.find((entry) => Number(entry[0]) >= 0 && Number(entry[0]) <= 100 && Number(entry[1]) >= 0 && Number(entry[1]) <= 100);
      if (point) return point;
    }
  }
  return [50, 50];
}

function levelFor(totalXp) {
  let level = 1;
  while (level < 60 && totalXp >= xpAtLevel.get(level + 1)) level += 1;
  return level;
}

function questRecord(quest, name = quest.name) {
  const requiredLevel = questRequiredLevel(quest);
  return {
    questId: quest.questId,
    name,
    questLevel: requiredLevel,
    requiredLevel,
    xp: Number(quest.xp) || 0,
    faction: quest.faction === 'Horde' ? 'Horde' : quest.faction === 'Alliance' ? 'Alliance' : 'Both',
  };
}

function buildRoute() {
  const questCatalog = JSON.parse(fs.readFileSync(path.join(root, 'quest_catalog.json'), 'utf8')).quests;
  const dungeonCatalog = JSON.parse(fs.readFileSync(path.join(root, 'dungeon_quest_db.json'), 'utf8'));
  const questById = new Map(questCatalog.map((quest) => [quest.questId, quest]));
  const xpAtLevel = new Map(xpLevels.map((entry) => [entry.level, entry.totalXp]));
  let totalXp = xpAtLevel.get(12);
  let currentLevel = 12;
  let stepNumber = 0;
  let previousName = '';
  let lastPosition = [50, 50];
  let lastZone = 'Stormwind City';
  let questCountLevel = 12;
  let questsAtLevel = 0;
  const route = [];
  const usedQuestIds = new Set();
  const visitedDungeons = new Set();

  const mandatoryDungeons = dungeonOrder.map((name) => dungeonCatalog.find((dungeon) => dungeon.name === name)).filter(Boolean)
    .map((dungeon) => {
      const playableQuests = dungeon.quests.filter((quest) => quest.faction !== 'Horde');
      return { ...dungeon, playableQuests };
    })
    .filter((dungeon) => dungeon.playableQuests.length >= 4)
    .map((dungeon) => {
      const dungeonQuests = dungeon.playableQuests.map((quest) => {
        const source = questById.get(quest.questId);
        return { ...quest, required: questRequiredLevel(source || quest) };
      });
      return {
        ...dungeon,
        dungeonQuests,
        gate: Math.max(dungeon.minLevel || 1, ...dungeonQuests.map((quest) => quest.required)),
      };
    });

  const dungeonQuestIds = new Set(mandatoryDungeons.flatMap((dungeon) => dungeon.dungeonQuests.map((quest) => quest.questId)));
  const worldQuestIds = new Set();
  const candidates = questCatalog.filter((quest) => {
    if (!quest.questId || quest.faction === 'Horde' || !(Number(quest.xp) > 0)) return false;
    if (quest.requiredClasses || quest.requiredRaceMask) return false;
    if (dungeonQuestIds.has(quest.questId)) return false;
    if (worldQuestIds.has(quest.questId)) return false;
    if (quest.starters?.itemIds?.length) return false;
    if (![...(quest.starters?.npcs || []), ...(quest.starters?.objects || [])].length) return false;
    const hasItemObjective = quest.objectiveSteps?.some((objective) => objective.kind === 'item');
    const hasKillObjective = quest.objectiveSteps?.some((objective) => objective.kind === 'npc');
    if (hasItemObjective && !hasKillObjective) return false;
    if (!starterZone(quest)) return false;
    worldQuestIds.add(quest.questId);
    return true;
  });
  const questByZone = new Map();
  for (const quest of candidates) {
    const zone = starterZone(quest);
    if (!questByZone.has(zone)) questByZone.set(zone, []);
    questByZone.get(zone).push(quest);
  }

  function addEntry(entry, reward) {
    stepNumber += 1;
    const name = entry.name;
    const dependencies = previousName ? [{ dungeonName: previousName }] : [];
    route.push({ ...entry, name, dependencies });
    previousName = name;
    totalXp += reward;
    currentLevel = levelFor(totalXp);
  }

  function maybeDoDungeon() {
    const dungeon = mandatoryDungeons.find((candidate) => !visitedDungeons.has(candidate.name) && candidate.gate <= currentLevel);
    if (!dungeon) return false;
    visitedDungeons.add(dungeon.name);
    lastZone = dungeonHubs[dungeon.name] || lastZone;
    const questsForDungeon = dungeon.dungeonQuests.map((quest) => questRecord(quest, quest.name));
    addEntry({
      name: dungeon.name,
      url: dungeon.url,
      levelRange: dungeon.levelRange,
      minLevel: dungeon.gate,
      maxLevel: dungeon.maxLevel,
      xpFromMonsters: 0,
      notes: dungeonNotes[dungeon.name],
      quests: questsForDungeon,
    }, questsForDungeon.reduce((sum, quest) => sum + quest.xp, 0));
    return true;
  }

  function choosePack(zone, needed, limit) {
    const available = (questByZone.get(zone) || []).filter((quest) =>
      !usedQuestIds.has(quest.questId) && questRequiredLevel(quest) <= currentLevel);
    const selected = [];
    let remaining = needed;
    while (available.length && remaining > 0 && selected.length < limit) {
      const fitting = available.filter((quest) => Number(quest.xp) <= remaining)
        .sort((left, right) => Number(right.xp) - Number(left.xp));
      let chosen = fitting[0];
      if (!chosen) {
        const smallest = [...available].sort((left, right) => Number(left.xp) - Number(right.xp))[0];
        if (!selected.length && Number(smallest.xp) <= needed * 1.35) chosen = smallest;
        else break;
      }
      if (!chosen) break;
      selected.push(chosen);
      usedQuestIds.add(chosen.questId);
      remaining -= Number(chosen.xp) || 0;
      available.splice(available.findIndex((quest) => quest.questId === chosen.questId), 1);
    }
    return selected;
  }

  function orderByGiverTravel(selected) {
    const remaining = [...selected];
    const ordered = [];
    let position = lastPosition;
    while (remaining.length) {
      let closestIndex = 0;
      let closestDistance = Infinity;
      for (let index = 0; index < remaining.length; index += 1) {
        const point = firstStarterPoint(remaining[index]);
        const distance = (point[0] - position[0]) ** 2 + (point[1] - position[1]) ** 2;
        if (distance < closestDistance) { closestDistance = distance; closestIndex = index; }
      }
      const [quest] = remaining.splice(closestIndex, 1);
      ordered.push(quest);
      position = firstStarterPoint(quest);
    }
    if (ordered.length) lastPosition = firstStarterPoint(ordered[ordered.length - 1]);
    return ordered;
  }

  while (currentLevel < 60 && stepNumber < 600) {
    if (currentLevel !== questCountLevel) {
      questCountLevel = currentLevel;
      questsAtLevel = 0;
    }
    if (maybeDoDungeon()) continue;

    const needed = Math.max(1, (xpAtLevel.get(currentLevel + 1) || xpAtLevel.get(60)) - totalXp);
    const zonePlan = zoneOrderByBand.find((band) => currentLevel <= band.max)?.zones || [];
    let addedQuestStep = false;
    const remainingQuestSlots = MAX_WORLD_QUESTS_PER_LEVEL - questsAtLevel;
    for (const zone of remainingQuestSlots > 0 ? zonePlan : []) {
      const selected = choosePack(zone, needed, remainingQuestSlots);
      if (!selected.length) continue;
      const ordered = orderByGiverTravel(selected);
      const groupedXp = ordered.reduce((sum, quest) => sum + (Number(quest.xp) || 0), 0);
      lastZone = zone;
      const levelName = String(currentLevel).padStart(2, '0');
      const name = `Level ${levelName} - ${zone}`;
      const zoneNotes = flightPathNotes[zone] || `Complete the nearby ${zone} quest loop before moving on.`;
      addEntry({
        name,
        levelRange: `${currentLevel}-${currentLevel}`,
        minLevel: currentLevel,
        maxLevel: currentLevel,
        xpFromMonsters: 0,
        notes: zoneNotes,
        quests: ordered.map((quest) => questRecord(quest)),
      }, groupedXp);
      questsAtLevel += ordered.length;
      addedQuestStep = true;
      break;
    }
    if (addedQuestStep) continue;

    const nextLevel = currentLevel + 1;
    const monsterXp = needed;
    const nearestZone = lastZone;
    addEntry({
      name: `Grind near ${nearestZone} to level ${nextLevel}`,
      levelRange: `${currentLevel}-${nextLevel}`,
      minLevel: currentLevel,
      maxLevel: nextLevel,
      grindToLevel: nextLevel,
      xpFromMonsters: monsterXp,
      notes: `Questie has no more nearby, non-item quest XP in this route segment. Grind nearby mobs for about ${monsterXp.toLocaleString()} XP to reach level ${nextLevel}.`,
      quests: [],
    }, monsterXp);
  }

  if (currentLevel < 60) throw new Error(`Route generation stopped at level ${currentLevel}; check candidate quest data.`);
  const dungeonCounts = route.filter((step) => mandatoryDungeons.some((dungeon) => dungeon.name === step.name));
  if (dungeonCounts.length !== mandatoryDungeons.length) throw new Error('Not all four-plus-quest dungeons were scheduled exactly once.');

  return {
    startMode: 'level',
    startValue: 12,
    startLevel: 12,
    faction: 'Alliance',
    route,
  };
}

const outputPath = path.resolve(process.argv[2] || path.join(root, 'level12-alliance-route.json'));
const payload = buildRoute();
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
const questCount = payload.route.reduce((sum, entry) => sum + entry.quests.length, 0);
console.log(`Wrote ${payload.route.length} route steps and ${questCount} quests to ${outputPath}`);
