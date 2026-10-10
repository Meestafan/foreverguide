(function (global) {
  const ADDON_FOLDER = 'Foreverguide_RestedXP';
  const EXPORT_INTERFACE = 16001;
  const encoder = new TextEncoder();

  function guideText(value) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').replace(/\]\]/g, '] ]').trim();
  }

  function numberText(value) {
    return Number(value).toFixed(2).replace(/\.?0+$/, '');
  }

  function firstWaypoint(locations = []) {
    for (const location of locations) {
      for (const zone of location.zones || []) {
        const point = zone.coordinates?.find((coordinate) => Number.isFinite(Number(coordinate[0])) && Number.isFinite(Number(coordinate[1])));
        const mapName = guideText(zone.zone);
        if (point && mapName && point[0] >= 0 && point[0] <= 100 && point[1] >= 0 && point[1] <= 100) {
          return { mapName, x: numberText(point[0]), y: numberText(point[1]) };
        }
      }
    }
    return null;
  }

  function locationName(locations = []) {
    return locations.map((location) => location.name).filter(Boolean).join(' or ');
  }

  function waypointActorName(locations = []) {
    return locations.find((location) => firstWaypoint([location]))?.name || locations[0]?.name || '';
  }

  function questPickupSteps(quest, dungeonName, routeNotes) {
    const lines = [];
    const questName = guideText(quest.name) || `Quest ${quest.questId}`;
    const questId = Number(quest.questId);
    const hasId = Number.isSafeInteger(questId) && questId > 0;
    const starterLocations = [...(quest.starters?.npcs || []), ...(quest.starters?.objects || [])];
    const starter = firstWaypoint(starterLocations);
    const starterName = locationName(starterLocations);
    const prefix = dungeonName ? `Dungeon: ${guideText(dungeonName)}. ` : '';
    const notes = routeNotes ? ` Travel: ${guideText(routeNotes)}` : '';

    lines.push('step');
    if (starter) lines.push(`.goto ${starter.mapName},${starter.x},${starter.y}`);
    if (starterName) lines.push(`>>${prefix}Talk to ${guideText(starterName)} to pick up ${questName}.${notes}`);
    else lines.push(`>>${prefix}Pick up ${questName}${quest.zone ? ` in ${guideText(quest.zone)}` : ''}.${notes}`);
    if (hasId) lines.push(`.accept ${questId} >>Accept ${questName}`);
    else lines.push(`*Quest has no Questie ID; track it manually: ${questName}`);
    return lines;
  }

  function questObjectiveSteps(quest) {
    const lines = [];
    const questName = guideText(quest.name) || `Quest ${quest.questId}`;
    const questId = Number(quest.questId);
    const hasId = Number.isSafeInteger(questId) && questId > 0;
    const objectives = Array.isArray(quest.objectiveSteps) ? quest.objectiveSteps : [];
    if (hasId && objectives.length) {
      for (const objective of objectives) {
        const waypoint = firstWaypoint(objective.locations || []);
        const actor = locationName(objective.locations || []);
        lines.push('step');
        if (waypoint) lines.push(`.goto ${waypoint.mapName},${waypoint.x},${waypoint.y}`);
        const description = guideText(objective.text) || actor || `${questName} objective ${objective.index}`;
        lines.push(`>>${actor ? `Go to ${guideText(actor)} and work on ${questName}.` : `Complete: ${description} (${questName}).`}`);
        lines.push(`.complete ${questId},${objective.index}`);
          const targetName = waypointActorName(objective.locations || []);
          if (targetName) lines.push(`.target ${guideText(targetName)}`);
      }
    }
      return lines;
    }

    function questTurnInSteps(quest) {
      const lines = [];
      const questName = guideText(quest.name) || `Quest ${quest.questId}`;
      const questId = Number(quest.questId);
      const hasId = Number.isSafeInteger(questId) && questId > 0;
    const turnInLocations = [...(quest.turnIns?.npcs || []), ...(quest.turnIns?.objects || [])];
    const turnIn = firstWaypoint(turnInLocations);
    const turnInName = locationName(turnInLocations);
    lines.push('step');
    if (turnIn) lines.push(`.goto ${turnIn.mapName},${turnIn.x},${turnIn.y}`);
    if (turnInName) lines.push(`>>Return to ${guideText(turnInName)} to turn in ${questName}.`);
    else lines.push(`>>Turn in ${questName}${quest.zone ? ` in ${guideText(quest.zone)}` : ''}.`);
    if (hasId) lines.push(`.turnin ${questId} >>Turn in ${questName}`);
    return lines;
  }

  function makeGuide(route, faction, startLevel) {
    const side = faction === 'Horde' ? 'Horde' : 'Alliance';
    const routeName = guideText(`Level ${startLevel} ${side} Route`);
    const lines = [
      'RXPGuides.RegisterGuide([[',
      '#forever',
      `<< ${side}`,
      `#name Foreverguide ${routeName}`,
      '#version 1',
      `#group Foreverguide Custom Routes (${side})`,
      '#subgroup Generated Routes',
    ];

    for (const dungeon of route) {
      const availableQuests = (dungeon.quests || []).filter((quest) => quest.faction !== (side === 'Horde' ? 'Alliance' : 'Horde'));
      if (!availableQuests.length) {
        lines.push('step');
        const minimumLevel = Math.max(1, Math.min(60, Number(dungeon.minLevel) || 1));
        const grindToLevel = Math.max(minimumLevel, Math.min(60, Number(dungeon.grindToLevel) || minimumLevel));
        lines.push(`>>${guideText(dungeon.notes || `Dungeon: ${dungeon.name} (levels ${dungeon.levelRange || ''}). No eligible quests are assigned.`)}`);
        lines.push(`.xp ${grindToLevel}`);
        continue;
      }
      availableQuests.forEach((quest, index) => {
        lines.push(...questPickupSteps(quest, index === 0 ? dungeon.name : '', index === 0 ? dungeon.notes : ''));
      });
      availableQuests.forEach((quest) => {
        lines.push(...questObjectiveSteps(quest));
      });
      availableQuests.forEach((quest) => {
        lines.push(...questTurnInSteps(quest));
      });
    }

    lines.push(']])');
    return lines.join('\n');
  }

  function makeReadme(guideName) {
    return [
      `Foreverguide RestedXP route: ${guideName}`,
      '',
      'Install:',
      '1. Close World of Warcraft.',
      '2. Extract the Foreverguide_RestedXP folder into the game version you play at Interface/AddOns.',
      '3. Start the game, enable Foreverguide RestedXP Route in the AddOns list, and reload if prompted.',
      '4. Open RestedXP and select the guide under Foreverguide Custom Routes.',
      '',
      'This is an independent custom guide addon. Quest data and map points come from QuestieDB and may be incomplete or outdated. Each actor/objective waypoint uses the first mapped Questie spawn; verify it in-game.',
    ].join('\n');
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function write16(view, offset, value) { view.setUint16(offset, value, true); }
  function write32(view, offset, value) { view.setUint32(offset, value >>> 0, true); }

  function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { result.set(part, offset); offset += part.length; }
    return result;
  }

  function zipStored(files) {
    const localParts = [];
    const centralParts = [];
    let localOffset = 0;
    const date = ((2026 - 1980) << 9) | (1 << 5) | 1;

    for (const file of files) {
      const name = encoder.encode(file.name);
      const data = encoder.encode(file.content);
      const checksum = crc32(data);
      const local = new Uint8Array(30 + name.length);
      const localView = new DataView(local.buffer);
      write32(localView, 0, 0x04034b50);
      write16(localView, 4, 20);
      write16(localView, 6, 0);
      write16(localView, 8, 0);
      write16(localView, 10, 0);
      write16(localView, 12, date);
      write32(localView, 14, checksum);
      write32(localView, 18, data.length);
      write32(localView, 22, data.length);
      write16(localView, 26, name.length);
      write16(localView, 28, 0);
      local.set(name, 30);
      localParts.push(local, data);

      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      write32(centralView, 0, 0x02014b50);
      write16(centralView, 4, 20);
      write16(centralView, 6, 20);
      write16(centralView, 8, 0);
      write16(centralView, 10, 0);
      write16(centralView, 12, 0);
      write16(centralView, 14, date);
      write32(centralView, 16, checksum);
      write32(centralView, 20, data.length);
      write32(centralView, 24, data.length);
      write16(centralView, 28, name.length);
      write16(centralView, 30, 0);
      write16(centralView, 32, 0);
      write16(centralView, 34, 0);
      write16(centralView, 36, 0);
      write32(centralView, 38, 0);
      write32(centralView, 42, localOffset);
      central.set(name, 46);
      centralParts.push(central);
      localOffset += local.length + data.length;
    }

    const centralDirectory = concatBytes(centralParts);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    write32(endView, 0, 0x06054b50);
    write16(endView, 4, 0);
    write16(endView, 6, 0);
    write16(endView, 8, files.length);
    write16(endView, 10, files.length);
    write32(endView, 12, centralDirectory.length);
    write32(endView, 16, localOffset);
    write16(endView, 20, 0);
    return concatBytes([...localParts, centralDirectory, end]);
  }

  function createAddonArchive(route, faction, startLevel) {
    if (!Array.isArray(route) || route.length === 0) throw new Error('Add at least one dungeon or route step before exporting.');
    const side = faction === 'Horde' ? 'Horde' : 'Alliance';
    const guideName = `Foreverguide Level ${startLevel} ${side} Route`;
    const toc = [
      `## Interface: ${EXPORT_INTERFACE}`,
      '## Title: Foreverguide RestedXP Route',
      '## Notes: Custom leveling route generated by Foreverguide.',
      '## Dependencies: RXPGuides',
      '',
      `${ADDON_FOLDER}.lua`,
      '',
    ].join('\n');
    const guide = makeGuide(route, side, startLevel);
    const files = [
      { name: `${ADDON_FOLDER}/${ADDON_FOLDER}.toc`, content: toc },
      { name: `${ADDON_FOLDER}/${ADDON_FOLDER}.lua`, content: guide },
      { name: `${ADDON_FOLDER}/README.txt`, content: makeReadme(guideName) },
    ];
    return { bytes: zipStored(files), filename: `foreverguide-rxp-route-${side.toLowerCase()}.zip`, guide, files };
  }

  global.ForeverguideRXPExport = { createAddonArchive };
}(window));
