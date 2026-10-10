const fs = require('node:fs');
const path = require('node:path');

const addonPath = process.argv[2] || String.raw`C:\Program Files (x86)\World of Warcraft\_classic_beta_\Interface\AddOns\QuestieDB`;
const outputPath = path.resolve(process.argv[3] || path.join(__dirname, '..', 'quest_catalog.json'));

function readMetadata(tocPath) {
  const values = new Map();
  for (const line of fs.readFileSync(tocPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^## X-([\w-]+):\s*(.*)$/);
    if (match) values.set(match[1], match[2].trim());
  }
  return values;
}

function storedValue(metadata, key) {
  const value = metadata.get(key);
  if (!value) return null;
  const chunkHeader = value.match(/^~(\d+)~$/);
  if (!chunkHeader) return value;
  let joined = '';
  for (let index = 1; index <= Number(chunkHeader[1]); index += 1) {
    const chunk = metadata.get(`${key}-${index}`);
    if (chunk === undefined) throw new Error(`Missing Questie metadata chunk ${key}-${index}`);
    joined += chunk;
  }
  return joined;
}

function decodeCbor(bytes) {
  let offset = 0;

  function readArgument(additional) {
    if (additional < 24) return additional;
    const widths = { 24: 1, 25: 2, 26: 4, 27: 8 };
    const width = widths[additional];
    if (!width) throw new Error(`Unsupported CBOR additional information ${additional}`);
    if (offset + width > bytes.length) throw new Error('Unexpected end of Questie CBOR data');
    let value;
    if (width === 8) value = Number(bytes.readBigUInt64BE(offset));
    else if (width === 4) value = bytes.readUInt32BE(offset);
    else if (width === 2) value = bytes.readUInt16BE(offset);
    else value = bytes[offset];
    offset += width;
    return value;
  }

  function readValue() {
    if (offset >= bytes.length) throw new Error('Unexpected end of Questie CBOR data');
    const initial = bytes[offset++];
    const major = initial >> 5;
    const additional = initial & 31;
    if (major === 0) return readArgument(additional);
    if (major === 1) return -1 - readArgument(additional);
    if (major === 2 || major === 3) {
      const length = readArgument(additional);
      const end = offset + length;
      if (end > bytes.length) throw new Error('Invalid Questie CBOR string length');
      const value = bytes.toString('utf8', offset, end);
      offset = end;
      return value;
    }
    if (major === 4) return Array.from({ length: readArgument(additional) }, readValue);
    if (major === 5) {
      const result = {};
      const length = readArgument(additional);
      for (let index = 0; index < length; index += 1) {
        result[String(readValue())] = readValue();
      }
      return result;
    }
    if (major === 6) {
      readArgument(additional);
      return readValue();
    }
    if (major === 7) {
      if (additional === 20) return false;
      if (additional === 21) return true;
      if (additional === 22 || additional === 23) return null;
      if (additional === 25) {
        const half = readArgument(additional);
        const sign = half & 0x8000 ? -1 : 1;
        const exponent = (half >> 10) & 0x1f;
        const fraction = half & 0x3ff;
        if (exponent === 0) return sign * 2 ** -14 * (fraction / 1024);
        if (exponent === 31) return fraction ? NaN : sign * Infinity;
        return sign * 2 ** (exponent - 15) * (1 + fraction / 1024);
      }
      if (additional === 26) {
        const value = bytes.readFloatBE(offset);
        offset += 4;
        return value;
      }
      if (additional === 27) {
        const value = bytes.readDoubleBE(offset);
        offset += 8;
        return value;
      }
    }
    throw new Error(`Unsupported Questie CBOR token 0x${initial.toString(16)}`);
  }

  const value = readValue();
  if (offset !== bytes.length) throw new Error(`Questie CBOR has ${bytes.length - offset} trailing bytes`);
  return value;
}

function decodeMetadata(metadata, key) {
  const value = storedValue(metadata, key);
  return value ? decodeCbor(Buffer.from(value, 'base64')) : null;
}

function readEntities(metadata, entityName) {
  const records = new Map();
  const rowPattern = new RegExp(`^${entityName}-(\\d+)-S$`);
  for (const key of metadata.keys()) {
    const match = key.match(rowPattern);
    if (!match) continue;
    const id = Number(match[1]);
    records.set(id, decodeMetadata(metadata, key) || {});
  }
  return records;
}

function readZoneNames(addonPath) {
  const source = fs.readFileSync(path.join(addonPath, 'src', 'corrections', 'enum', 'zones.lua'), 'utf8');
  const zones = new Map();
  for (const match of source.matchAll(/^\s+([A-Z][A-Z0-9_]*)\s*=\s*(\d+),/gm)) {
    const name = match[1].split('_').map((word) => word[0] + word.slice(1).toLowerCase()).join(' ');
    zones.set(Number(match[2]), name);
  }
  return zones;
}

function readQuestXp(addonPath) {
  const source = fs.readFileSync(path.join(addonPath, 'support', 'Forever', 'QuestXP', 'xpDB-classic.lua'), 'utf8');
  const xp = new Map();
  for (const match of source.matchAll(/^\s*\[(\d+)\]\s*=\s*\{\s*(-?\d+)\s*,\s*(\d+)\s*\}/gm)) {
    xp.set(Number(match[1]), { level: Number(match[2]), xp: Number(match[3]) });
  }
  return xp;
}

function field(metadata, entityName, id, index) {
  return decodeMetadata(metadata, `${entityName}-${id}-${index}`);
}

function numericIds(value) {
  return (Array.isArray(value) ? value : []).map(Number).filter(Number.isSafeInteger);
}

function locationRows(spawns, defaultZoneId, zones) {
  const locations = [];
  if (!spawns || typeof spawns !== 'object') return locations;
  for (const [rawZoneId, rows] of Object.entries(spawns)) {
    const zoneId = Number(rawZoneId) || defaultZoneId || null;
    const coordinates = Array.isArray(rows)
      ? rows.filter((row) => Array.isArray(row) && Number.isFinite(Number(row[0])) && Number.isFinite(Number(row[1])))
        .map((row) => [Number(row[0]), Number(row[1])])
      : [];
    if (coordinates.length) locations.push({ zoneId, zone: zones.get(zoneId) || null, coordinates });
  }
  return locations;
}

function makeLocation(metadata, kind, id, npcs, objects, zones) {
  const records = kind === 'npc' ? npcs : objects;
  const row = records.get(id) || {};
  const spawnIndex = kind === 'npc' ? 7 : 4;
  const zoneIndex = kind === 'npc' ? 9 : 5;
  return {
    id,
    name: row['1'] || `${kind === 'npc' ? 'NPC' : 'Object'} ${id}`,
    zones: locationRows(field(metadata, kind === 'npc' ? 'Npc' : 'Object', id, spawnIndex), row[String(zoneIndex)], zones),
  };
}

function collectObjectiveIds(rows, includeBaseId = false) {
  const ids = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!Array.isArray(row)) continue;
    const references = row[0];
    for (const id of Array.isArray(references) ? references : [references]) {
      if (Number.isSafeInteger(Number(id)) && Number(id) > 0) ids.add(Number(id));
    }
    if (includeBaseId && Number.isSafeInteger(Number(row[1])) && Number(row[1]) > 0) ids.add(Number(row[1]));
  }
  return [...ids];
}

function collectObjectiveSteps(groups) {
  const steps = [];
  const addRows = (rows, kind, idsFromRow, textFromRow) => {
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!Array.isArray(row)) continue;
      steps.push({
        index: steps.length + 1,
        kind,
        entityIds: idsFromRow(row),
        text: textFromRow(row) || null,
      });
    }
  };

  addRows(groups[0], 'npc', (row) => numericIds([row[0]]), (row) => row[1]);
  addRows(groups[1], 'object', (row) => numericIds([row[0]]), (row) => row[1]);
  addRows(groups[2], 'item', (row) => numericIds([row[0]]), (row) => row[1]);
  if (Array.isArray(groups[3]) && groups[3].length) {
    steps.push({ index: steps.length + 1, kind: 'reputation', entityIds: [], text: null });
  }
  addRows(groups[4], 'npc', (row) => [...new Set([...numericIds(row[0]), ...numericIds([row[1]])])], (row) => row[2]);
  addRows(groups[5], 'spell', (row) => [], (row) => row[1]);
  return steps;
}

function factionFromRaceMask(value) {
  const mask = Number(value) >>> 0;
  if (!mask) return 'Both';
  const alliance = (mask & 71) !== 0;
  const horde = (mask & 184) !== 0;
  if (alliance && !horde) return 'Alliance';
  if (horde && !alliance) return 'Horde';
  return 'Both';
}

function main() {
  const tocPath = path.join(addonPath, 'QuestieDB_Forever.toc');
  const metadata = readMetadata(tocPath);
  const quests = readEntities(metadata, 'Quest');
  const npcs = readEntities(metadata, 'Npc');
  const objects = readEntities(metadata, 'Object');
  const zones = readZoneNames(addonPath);
  const xp = readQuestXp(addonPath);

  const catalog = [...quests.entries()].map(([id, row]) => {
    const startedBy = field(metadata, 'Quest', id, 2) || [];
    const finishedBy = field(metadata, 'Quest', id, 3) || [];
    const objectiveGroups = field(metadata, 'Quest', id, 10) || [];
    const triggerEnd = field(metadata, 'Quest', id, 9);
    const starterNpcIds = numericIds(startedBy[0]);
    const starterObjectIds = numericIds(startedBy[1]);
    const finisherNpcIds = numericIds(finishedBy[0]);
    const finisherObjectIds = numericIds(finishedBy[1]);
    const objectiveNpcIds = [
      ...collectObjectiveIds(objectiveGroups[0]),
      ...collectObjectiveIds(objectiveGroups[4], true),
    ];
    const objectiveObjectIds = collectObjectiveIds(objectiveGroups[1]);
    const objectiveSteps = collectObjectiveSteps(objectiveGroups);
    const questXp = xp.get(id);
    const zoneId = Number(row['17']) > 0 ? Number(row['17']) : null;
    const completionSpawns = Array.isArray(triggerEnd) ? triggerEnd[1] : null;
    const starters = {
      npcs: starterNpcIds.map((npcId) => makeLocation(metadata, 'npc', npcId, npcs, objects, zones)),
      objects: starterObjectIds.map((objectId) => makeLocation(metadata, 'object', objectId, npcs, objects, zones)),
      itemIds: numericIds(startedBy[2]),
    };
    const turnIns = {
      npcs: finisherNpcIds.map((npcId) => makeLocation(metadata, 'npc', npcId, npcs, objects, zones)),
      objects: finisherObjectIds.map((objectId) => makeLocation(metadata, 'object', objectId, npcs, objects, zones)),
    };
    const objectiveLocations = [
      ...objectiveNpcIds.map((npcId) => makeLocation(metadata, 'npc', npcId, npcs, objects, zones)),
      ...objectiveObjectIds.map((objectId) => makeLocation(metadata, 'object', objectId, npcs, objects, zones)),
    ];
    for (const objective of objectiveSteps) {
      const kind = objective.kind === 'object' ? 'object' : 'npc';
      objective.locations = ['npc', 'object'].includes(objective.kind)
        ? objective.entityIds.map((entityId) => makeLocation(metadata, kind, entityId, npcs, objects, zones))
        : [];
    }
    const fallbackZone = [...starters.npcs, ...starters.objects, ...turnIns.npcs, ...turnIns.objects, ...objectiveLocations]
      .flatMap((location) => location.zones)
      .find((zone) => zone.zone)?.zone;

    return {
      questId: id,
      name: row['1'] || `Quest ${id}`,
      requiredLevel: Number(row['4']) || 0,
      questLevel: Number(row['5']) || Number(row['4']) || 1,
      xp: questXp?.xp ?? 0,
      faction: factionFromRaceMask(row['6']),
      requiredRaceMask: Number(row['6']) >>> 0,
      zoneId,
      zone: zones.get(zoneId) || fallbackZone || null,
      starters,
      turnIns,
      objectiveLocations,
      objectiveSteps,
      completionWaypoints: locationRows(completionSpawns, zoneId, zones),
      objectiveText: field(metadata, 'Quest', id, 8) || [],
      preQuestGroup: numericIds(field(metadata, 'Quest', id, 12)),
      preQuestSingle: numericIds(field(metadata, 'Quest', id, 13)),
    };
  }).filter((quest) => quest.name);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify({ source: 'QuestieDB Forever', builtAt: new Date().toISOString(), quests: catalog }, null, 2)}\n`);
  console.log(`Wrote ${catalog.length} quests (${npcs.size} NPCs, ${objects.size} objects, ${xp.size} XP records) to ${outputPath}`);
}

let metadata;
try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}