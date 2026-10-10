const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { JSDOM } = require('jsdom');

const root = path.join(__dirname, '..');
const plannerPath = root;
const html = fs.readFileSync(path.join(plannerPath, 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(plannerPath, 'app.js'), 'utf8');
const rxpExport = fs.readFileSync(path.join(plannerPath, 'rxp-export.js'), 'utf8');
const xpData = JSON.parse(fs.readFileSync(path.join(plannerPath, 'xp_per_level.json'), 'utf8'));
const dungeonData = JSON.parse(fs.readFileSync(path.join(plannerPath, 'dungeon_quest_db.json'), 'utf8'));
const questCatalogData = JSON.parse(fs.readFileSync(path.join(plannerPath, 'quest_catalog.json'), 'utf8'));

async function loadPlanner(url = 'http://localhost/foreverguide/', seedDefaultRoute = true) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only' });
  const { window } = dom;
  window.TextEncoder = TextEncoder;
  window.TextDecoder = TextDecoder;
  window.structuredClone = structuredClone;
  window.history.replaceState = () => {};
  window.HTMLElement.prototype.scrollIntoView = function () { window.lastScrolledElement = this; };
  window.URL.createObjectURL = (blob) => { window.exportedBlob = blob; return 'blob:foreverguide-export'; };
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () { window.downloadedFile = this.download; };
  window.fetch = async (url) => ({
    ok: true,
    json: async () => String(url).includes('xp_per_level') ? xpData
      : String(url).includes('quest_catalog') ? questCatalogData : dungeonData,
  });
  window.eval(rxpExport);
  window.eval(app);
  await new Promise((resolve) => setTimeout(resolve, 0));
  if (seedDefaultRoute) {
    window.importPoolJson(JSON.stringify({ startMode: 'level', startValue: 10, faction: 'Alliance', route: dungeonData }));
  }
  return { dom, window, document: window.document };
}

function dispatch(window, element, type) {
  element.dispatchEvent(new window.Event(type, { bubbles: true }));
}

function dragQuest(window, source, target, clientY = 0) {
  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    setData() {},
  };
  for (const [type, element] of [['dragstart', source], ['dragover', target], ['drop', target]]) {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    Object.defineProperty(event, 'clientY', { value: clientY });
    element.dispatchEvent(event);
  }
}

function readStoredZip(bytes) {
  const buffer = Buffer.from(bytes);
  const files = new Map();
  let offset = 0;
  while (buffer.readUInt32LE(offset) === 0x04034b50) {
    const method = buffer.readUInt16LE(offset + 8);
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = buffer.toString('utf8', nameStart, nameStart + nameLength);
    assert.equal(method, 0);
    files.set(name, buffer.toString('utf8', dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return files;
}

test('loads structured JSON databases and supports fractional levels and total XP', async () => {
  assert.equal(xpData.levels.length, 59);
  assert.equal(dungeonData.length, 18);
  assert.equal(dungeonData.reduce((count, dungeon) => count + dungeon.quests.length, 0), 113);
  assert.equal(questCatalogData.quests.length, 5010);
  assert.ok(questCatalogData.quests.some((quest) => quest.questId === 2 && quest.name === "Sharptalon's Claw"));
  assert.deepEqual(dungeonData.flatMap((dungeon) => dungeon.quests).reduce((counts, quest) => {
    counts[quest.faction] = (counts[quest.faction] || 0) + 1;
    return counts;
  }, {}), { Both: 71, Alliance: 37, Horde: 5 });

  const questVersions = (dungeonName, questName) => dungeonData.find((dungeon) => dungeon.name === dungeonName).quests
    .filter((quest) => quest.name === questName)
    .map(({ faction, questId }) => [faction, questId]);
  assert.deepEqual(questVersions('Ruins of Lordaeron', 'Crest of Lordaeron'), [['Alliance', 95189], ['Horde', 95204]]);
  assert.deepEqual(questVersions('Uldaman', 'Reclaimed Treasures'), [['Alliance', 1360], ['Horde', 2342]]);
  assert.deepEqual(questVersions('Maraudon', 'Vyletongue Corruption'), [['Horde', 7029], ['Alliance', 7041]]);
  assert.deepEqual(questVersions('Maraudon', 'Corruption of Earth and Seed'), [['Horde', 7064], ['Alliance', 7065]]);

  const { dom, window, document } = await loadPlanner();
  const startValue = document.querySelector('#start-value');
  startValue.value = '10.5';
  dispatch(window, startValue, 'input');
  assert.equal(document.querySelector('#summary-start-level').textContent, '10.5');

  const startMode = document.querySelector('#start-mode');
  startMode.value = 'xp';
  dispatch(window, startMode, 'change');
  assert.equal(startValue.value, '31400');
  assert.equal(document.querySelector('#summary-start-level').textContent, '10.5');
  startValue.value = '30000';
  dispatch(window, startValue, 'input');
  assert.equal(document.querySelector('#summary-start-level').textContent, '10.32');
});

test('renames the planner and expands both source pools by default', async () => {
  const { document } = await loadPlanner('http://localhost/foreverguide/', false);
  const dungeonPool = document.querySelector('.dungeon-source-panel');
  const questPool = document.querySelector('.quest-source-panel');
  const dungeonToggle = document.querySelector('#toggle-dungeons-btn');
  const questToggle = document.querySelector('#toggle-quests-btn');
  assert.equal(document.title, 'WoW: Forever Leveling Route Planner');
  assert.match(document.querySelector('h1').textContent, /Leveling Route Planner/);
  assert.equal(dungeonToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(questToggle.getAttribute('aria-expanded'), 'true');
  assert.equal(document.querySelector('#dungeon-pool-content').hidden, false);
  assert.equal(document.querySelector('#quest-pool-content').hidden, false);

  dungeonToggle.click();
  assert.equal(dungeonToggle.getAttribute('aria-expanded'), 'false');
  assert.equal(questToggle.getAttribute('aria-expanded'), 'true');
  questToggle.click();
  assert.equal(questToggle.getAttribute('aria-expanded'), 'false');
});

test('collapses all builder sections after calculation and exposes route rules', async () => {
  const { document } = await loadPlanner('http://localhost/foreverguide/', false);
  const content = document.querySelector('#route-content');
  const toggle = document.querySelector('#toggle-route-btn');
  assert.equal(content.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(document.querySelector('.route-rules-tooltip [role="tooltip"]').textContent.includes('Quest XP'), true);

  document.querySelector('#calculate-btn').click();
  assert.equal(content.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(document.querySelector('#toggle-dungeons-btn').getAttribute('aria-expanded'), 'false');
  assert.equal(document.querySelector('#toggle-quests-btn').getAttribute('aria-expanded'), 'false');
  assert.equal(document.querySelector('#route-output').hidden, false);

  toggle.click();
  assert.equal(content.hidden, false);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
});

test('confirms before clearing the route and respects cancellation', async () => {
  const { window, document } = await loadPlanner();
  const originalCount = JSON.parse(window.exportPoolJson()).route.length;
  window.confirm = () => false;
  document.querySelector('#reset-route-btn').click();
  assert.equal(JSON.parse(window.exportPoolJson()).route.length, originalCount);

  window.confirm = () => true;
  document.querySelector('#reset-route-btn').click();
  assert.equal(JSON.parse(window.exportPoolJson()).route.length, 0);
});

test('searches the Questie catalog and adds a quest with its location metadata', async () => {
  const { window, document } = await loadPlanner('http://localhost/foreverguide/', false);
  const questSearch = document.querySelector('#quest-search');
  questSearch.value = 'Kobold Camp Cleanup';
  dispatch(window, questSearch, 'input');
  const questItem = document.querySelector('.quest-pool-item');
  assert.match(questItem.textContent, /Kobold Camp Cleanup/);
  assert.match(questItem.textContent, /Elwynn Forest/);

  const dungeonIndex = dungeonData.findIndex((dungeon) => dungeon.name === 'The Hall of Thanes');
  document.querySelector(`.pool-item[data-pool-dungeon-index="${dungeonIndex}"] .add-pool-dungeon-btn`).click();
  const routeCard = document.querySelector('.dungeon-card');
  const refreshedQuestItem = document.querySelector('.quest-pool-item');
  dragQuest(window, refreshedQuestItem, routeCard);

  const exported = JSON.parse(window.exportPoolJson());
  const addedQuest = exported.route[0].quests.find((quest) => quest.questId === 7);
  assert.equal(addedQuest.name, 'Kobold Camp Cleanup');
  assert.equal(addedQuest.starters.npcs[0].name, 'Marshal McBride');
  assert.deepEqual(addedQuest.starters.npcs[0].zones[0].coordinates[0], [48.92, 41.61]);
  assert.equal(addedQuest.turnIns.npcs[0].name, 'Marshal McBride');
  assert.equal(addedQuest.objectiveLocations[0].name, 'Kobold Vermin');

  document.querySelector('.dungeon-card details').open = true;
  assert.match(document.querySelector('.dungeon-card-quests').textContent, /Marshal McBride/);
  assert.match(document.querySelector('.dungeon-card-quests').textContent, /48\.9, 41\.6/);
});

test('enriches imported dungeon quests from Questie without replacing planner values', async () => {
  const { window } = await loadPlanner('http://localhost/foreverguide/', false);
  window.importPoolJson(JSON.stringify({
    startMode: 'level',
    startValue: 10,
    faction: 'Alliance',
    route: [{
      name: 'Legacy route dungeon',
      levelRange: '1-10',
      quests: [{ name: 'Legacy quest label', questId: 7, questLevel: 3, xp: 999, faction: 'Horde' }],
    }],
  }));
  const quest = JSON.parse(window.exportPoolJson()).route[0].quests[0];
  assert.equal(quest.name, 'Legacy quest label');
  assert.equal(quest.xp, 999);
  assert.equal(quest.faction, 'Horde');
  assert.equal(quest.starters.npcs[0].name, 'Marshal McBride');
  assert.equal(quest.objectiveLocations[0].name, 'Kobold Vermin');
});

test('preserves route notes through JSON and includes them in the RXP guide', async () => {
  const { window, document } = await loadPlanner('http://localhost/foreverguide/', false);
  const quest = questCatalogData.quests.find((entry) => entry.questId === 7);
  window.importPoolJson(JSON.stringify({
    startMode: 'level',
    startValue: 12,
    faction: 'Alliance',
    route: [{
      name: 'Westfall Hub',
      minLevel: 12,
      levelRange: '12-16',
      notes: 'Get the Sentinel Hill flight path before leaving Westfall.',
      quests: [quest],
    }],
  }));
  assert.match(document.querySelector('.dungeon-route-notes').textContent, /Sentinel Hill flight path/);
  assert.match(JSON.parse(window.exportPoolJson()).route[0].notes, /Sentinel Hill flight path/);
  const guide = window.ForeverguideRXPExport.createAddonArchive(JSON.parse(window.exportPoolJson()).route, 'Alliance', 12).guide;
  assert.match(guide, /Travel: Get the Sentinel Hill flight path/);
});

test('searches dungeons and supports adding a dungeon from its pool', async () => {
  const { window, document } = await loadPlanner('http://localhost/foreverguide/', false);
  const search = document.querySelector('#dungeon-search');
  search.value = 'uldaman';
  dispatch(window, search, 'input');
  assert.equal(document.querySelectorAll('#dungeon-pool .pool-item').length, 1);
  assert.match(document.querySelector('#dungeon-pool').textContent, /Uldaman/);

  const item = document.querySelector('#dungeon-pool .pool-item');
  const route = document.querySelector('#route-editor');
  const dataTransfer = { effectAllowed: '', dropEffect: '', setData() {} };
  for (const [type, element] of [['dragstart', item], ['drop', route]]) {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
    element.dispatchEvent(event);
  }
  assert.equal(document.querySelector('.dungeon-card h3').textContent, 'Uldaman');
});

test('filters quests by faction and keeps Both quests included', async () => {
  const { window, document } = await loadPlanner();
  const startValue = document.querySelector('#start-value');
  startValue.value = '20';
  dispatch(window, startValue, 'input');
  assert.match(document.querySelector('#faction-status').textContent, /37 Alliance-only · 71 Both factions · 5 Horde-only/);
  assert.match(document.querySelector('#faction-status').textContent, /^Quests in route:/);
  assert.deepEqual([...document.querySelector('#faction').options].map((option) => option.value), ['Alliance', 'Horde']);

  const faction = document.querySelector('#faction');
  faction.value = 'Alliance';
  dispatch(window, faction, 'change');
  let routeSteps = [...document.querySelectorAll('.route-step')];
  let hallQuests = routeSteps.find((step) => step.querySelector('h3').textContent.includes('The Hall of Thanes')).textContent;
  let wailingQuests = routeSteps.find((step) => step.querySelector('h3').textContent.includes('Wailing Caverns')).textContent;
  assert.match(hallQuests, /Old Ironforge Incursion/);
  assert.doesNotMatch(wailingQuests, /Serpentbloom/);
  assert.match(document.querySelector('#faction-status').textContent, /37 Alliance-only · 71 Both factions · 5 Horde-only/);

  faction.value = 'Horde';
  dispatch(window, faction, 'change');
  routeSteps = [...document.querySelectorAll('.route-step')];
  hallQuests = routeSteps.find((step) => step.querySelector('h3').textContent.includes('The Hall of Thanes')).textContent;
  wailingQuests = routeSteps.find((step) => step.querySelector('h3').textContent.includes('Wailing Caverns')).textContent;
  assert.doesNotMatch(hallQuests, /Old Ironforge Incursion/);
  assert.match(wailingQuests, /Serpentbloom/);

  document.querySelector('#add-dungeon-btn').click();
  assert.equal(document.querySelector('.quest-faction').value, 'Both');
});

test('imports older JSON route snapshots and resolves canonical faction metadata', async () => {
  const wailingCaverns = structuredClone(dungeonData.find((dungeon) => dungeon.name === 'Wailing Caverns'));
  for (const quest of wailingCaverns.quests) delete quest.faction;
  const legacyDungeon = {
    name: 'Legacy custom dungeon',
    levelRange: '1-20',
    quests: [{ name: 'Legacy custom quest', questLevel: 1, xp: 0, url: 'https://www.wowhead.com/forever/quest=76543/legacy-custom-quest' }],
  };
  const payload = {
    startMode: 'level',
    startValue: 20,
    faction: 'Alliance',
    route: [wailingCaverns, legacyDungeon],
  };
  const { window, document } = await loadPlanner('http://localhost/foreverguide/', false);
  window.importPoolJson(JSON.stringify(payload));
  const wailingRoute = [...document.querySelectorAll('.route-step')]
    .find((step) => step.querySelector('h3').textContent.includes('Wailing Caverns'));

  assert.ok(wailingRoute);
  assert.doesNotMatch(wailingRoute.textContent, /Serpentbloom/);
  assert.equal(wailingRoute.querySelectorAll('li').length, 4);
  const legacyRoute = [...document.querySelectorAll('.route-step')]
    .find((step) => step.querySelector('h3').textContent.includes('Legacy custom dungeon'));
  assert.equal(legacyRoute.querySelector('li a').href, 'https://www.wowhead.com/forever/quest=76543');
});

test('enters a dungeon only when every quest is available and never repeats a dungeon', async () => {
  const { window, document } = await loadPlanner();
  const startValue = document.querySelector('#start-value');
  startValue.value = '14';
  dispatch(window, startValue, 'input');

  const steps = [...document.querySelectorAll('.route-step')];
  const names = steps.map((step) => step.querySelector('h3').textContent.replace(/^Step \d+: /, ''));
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.filter((name) => name === 'Ruins of Lordaeron').length, 1);
  for (const step of steps) {
    const name = step.querySelector('h3').textContent.replace(/^Step \d+: /, '');
    const dungeon = dungeonData.find((record) => record.name === name);
    assert.equal(step.querySelectorAll('li').length, dungeon.quests.filter((quest) => quest.faction !== 'Horde').length);
  }
});

test('searches and applies dungeon-only prerequisites', async () => {
  const { dom, window, document } = await loadPlanner();
  const startValue = document.querySelector('#start-value');
  startValue.value = '13';
  dispatch(window, startValue, 'input');
  document.querySelector('.edit-dungeon-btn[data-index="0"]').click();

  const dependencySearch = document.querySelector('.dependency-search');
  dependencySearch.value = 'uldaman';
  dispatch(window, dependencySearch, 'input');
  const dungeonDependencies = document.querySelector('.dungeon-dependencies');
  const visibleOptions = [...dungeonDependencies.options].filter((option) => !option.hidden);
  assert.equal(visibleOptions.length, 1);
  assert.equal(visibleOptions[0].value, 'Uldaman');
  visibleOptions[0].selected = true;
  dispatch(window, dungeonDependencies, 'change');
  assert.match(document.querySelector('#reasons-output').textContent, /Route prerequisite not completed/);
  assert.doesNotMatch(document.querySelector('#route-output').textContent, /Step 1: The Hall of Thanes/);
  assert.equal(document.querySelector('.quest-dependencies'), null);
});

test('keeps upstream and downstream dependencies reciprocal and orders the route', async () => {
  const { window, document } = await loadPlanner();
  assert.equal(document.querySelector('.dungeon-card-dependencies'), null);
  const hallIndex = dungeonData.findIndex((dungeon) => dungeon.name === 'The Hall of Thanes');
  const wailingIndex = dungeonData.findIndex((dungeon) => dungeon.name === 'Wailing Caverns');
  const deadminesIndex = dungeonData.findIndex((dungeon) => dungeon.name === 'Deadmines');

  document.querySelector(`.edit-dungeon-btn[data-index="${wailingIndex}"]`).click();
  const upstream = document.querySelector('.dungeon-dependencies');
  const downstream = document.querySelector('.dungeon-downstream-dependencies');
  upstream.querySelector('option[value="The Hall of Thanes"]').selected = true;
  downstream.querySelector('option[value="Deadmines"]').selected = true;
  dispatch(window, upstream, 'change');
  dispatch(window, downstream, 'change');
  document.querySelector('.save-dungeon-btn').click();

  const hallDetails = document.querySelector(`.dungeon-card[data-index="${hallIndex}"] .dungeon-card-dependencies`).textContent;
  const wailingDetails = document.querySelector(`.dungeon-card[data-index="${wailingIndex}"] .dungeon-card-dependencies`).textContent;
  const deadminesDetails = document.querySelector(`.dungeon-card[data-index="${deadminesIndex}"] .dungeon-card-dependencies`).textContent;
  assert.equal(document.querySelector(`.dungeon-card[data-index="${wailingIndex}"] details`).open, false);
  assert.equal(document.querySelector(`.dungeon-card[data-index="${wailingIndex}"] .dungeon-card-dependencies`).closest('details'), null);
  assert.match(hallDetails, /Completion unlocks: Wailing Caverns/);
  assert.doesNotMatch(hallDetails, /Requires completion of:/);
  assert.match(wailingDetails, /Requires completion of: The Hall of Thanes/);
  assert.match(wailingDetails, /Completion unlocks: Deadmines/);
  assert.match(deadminesDetails, /Requires completion of: Wailing Caverns/);
  assert.doesNotMatch(deadminesDetails, /Completion unlocks:/);

  document.querySelector(`.edit-dungeon-btn[data-index="${hallIndex}"]`).click();
  assert.equal(document.querySelector('.dungeon-downstream-dependencies option[value="Wailing Caverns"]').selected, true);
  document.querySelector('.cancel-edit-btn').click();

  document.querySelector(`.edit-dungeon-btn[data-index="${deadminesIndex}"]`).click();
  assert.equal(document.querySelector('.dungeon-dependencies option[value="Wailing Caverns"]').selected, true);
  document.querySelector('.cancel-edit-btn').click();

  const startValue = document.querySelector('#start-value');
  startValue.value = '15';
  dispatch(window, startValue, 'input');
  const routeNames = [...document.querySelectorAll('.route-step h3')]
    .map((heading) => heading.textContent.replace(/^Step \d+: /, ''));
  assert.ok(routeNames.indexOf('The Hall of Thanes') < routeNames.indexOf('Wailing Caverns'), routeNames.join(' -> '));
  assert.ok(routeNames.indexOf('Wailing Caverns') < routeNames.indexOf('Deadmines'), routeNames.join(' -> '));
});

test('reorders dungeon cards by drag and drop', async () => {
  const { window, document } = await loadPlanner();
  const cards = [...document.querySelectorAll('.dungeon-card')];
  assert.equal(cards[0].querySelector('h3').textContent, 'The Hall of Thanes');
  assert.equal(cards[1].querySelector('h3').textContent, 'Ruins of Lordaeron');

  const dataTransfer = {
    effectAllowed: '',
    dropEffect: '',
    data: '',
    setData(type, value) { this.data = `${type}:${value}`; },
  };
  const dragStart = new window.Event('dragstart', { bubbles: true, cancelable: true });
  Object.defineProperty(dragStart, 'dataTransfer', { value: dataTransfer });
  cards[0].dispatchEvent(dragStart);
  assert.equal(dataTransfer.data, 'text/plain:0');

  const dragOver = new window.Event('dragover', { bubbles: true, cancelable: true });
  Object.defineProperty(dragOver, 'dataTransfer', { value: dataTransfer });
  cards[1].dispatchEvent(dragOver);
  assert.equal(dragOver.defaultPrevented, true);

  const drop = new window.Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: dataTransfer });
  cards[1].dispatchEvent(drop);

  const reorderedCards = [...document.querySelectorAll('.dungeon-card')];
  assert.equal(reorderedCards[0].querySelector('h3').textContent, 'Ruins of Lordaeron');
  assert.equal(reorderedCards[1].querySelector('h3').textContent, 'The Hall of Thanes');
  assert.equal(JSON.parse(window.exportPoolJson()).route[0].name, 'Ruins of Lordaeron');
});

test('reorders quests within a dungeon and transfers quests between dungeons', async () => {
  const { window, document } = await loadPlanner();
  const firstCard = document.querySelector('.dungeon-card[data-index="0"]');
  firstCard.querySelector('details').open = true;
  const firstQuestList = firstCard.querySelector('.dungeon-card-quests');
  const originalQuests = JSON.parse(window.exportPoolJson()).route[0].quests;
  const sourceQuest = firstQuestList.querySelector('li[data-quest-index="0"]');
  const targetQuest = firstQuestList.querySelector('li[data-quest-index="2"]');
  targetQuest.getBoundingClientRect = () => ({ top: 0, height: 10 });
  dragQuest(window, sourceQuest, targetQuest, 9);

  let pool = JSON.parse(window.exportPoolJson());
  assert.equal(document.querySelector('.dungeon-card[data-index="0"] details').open, true);
  assert.deepEqual(pool.route[0].quests.map((quest) => quest.name), [
    ...originalQuests.slice(1, 3).map((quest) => quest.name),
    originalQuests[0].name,
    ...originalQuests.slice(3).map((quest) => quest.name),
  ]);

  const sourceCard = document.querySelector('.dungeon-card[data-index="0"]');
  const destinationCard = document.querySelector('.dungeon-card[data-index="1"]');
  sourceCard.querySelector('details').open = true;
  destinationCard.querySelector('details').open = true;
  const movedQuest = pool.route[0].quests[0];
  const sourceItem = sourceCard.querySelector('.dungeon-card-quests li[data-quest-index="0"]');
  const destinationItem = destinationCard.querySelector('.dungeon-card-quests li[data-quest-index="0"]');
  destinationItem.getBoundingClientRect = () => ({ top: 0, height: 10 });
  dragQuest(window, sourceItem, destinationItem);

  pool = JSON.parse(window.exportPoolJson());
  assert.equal(document.querySelector('.dungeon-card[data-index="0"] details').open, true);
  assert.equal(document.querySelector('.dungeon-card[data-index="1"] details').open, true);
  assert.equal(pool.route[0].quests.some((quest) => quest.name === movedQuest.name), false);
  assert.deepEqual(pool.route[1].quests[0], movedQuest);
  assert.equal(pool.route.reduce((count, dungeon) => count + dungeon.quests.length, 0), dungeonData.reduce((count, dungeon) => count + dungeon.quests.length, 0));
});

test('reorders quests while editing a dungeon', async () => {
  const { window, document } = await loadPlanner();
  document.querySelector('.edit-dungeon-btn[data-index="0"]').click();
  const initialQuests = JSON.parse(window.exportPoolJson()).route[0].quests;
  const sourceRow = document.querySelector('.quest-row[data-quest-index="0"]');
  const targetRow = document.querySelector('.quest-row[data-quest-index="2"]');
  targetRow.getBoundingClientRect = () => ({ top: 0, height: 10 });
  dragQuest(window, sourceRow, targetRow, 9);

  const editedNames = [...document.querySelectorAll('.quest-row .quest-name')].map((input) => input.value);
  const savedQuests = JSON.parse(window.exportPoolJson()).route[0].quests;
  const expectedNames = [
    ...initialQuests.slice(1, 3).map((quest) => quest.name),
    initialQuests[0].name,
    ...initialQuests.slice(3).map((quest) => quest.name),
  ];
  assert.deepEqual(editedNames, expectedNames);
  assert.deepEqual(savedQuests.map((quest) => quest.name), expectedNames);
});

test('renders and edits the configured dungeon and quest hyperlinks', async () => {
  const { window, document } = await loadPlanner();
  const hallCard = [...document.querySelectorAll('.dungeon-card')]
    .find((card) => card.querySelector('h3').textContent.includes('The Hall of Thanes'));
  const dungeonLink = hallCard.querySelector('h3 a');
  assert.equal(dungeonLink.href, 'https://www.wowhead.com/forever/guide/dungeons-overview-locations-details#hall-of-thanes');
  assert.equal(dungeonLink.target, '_blank');
  const oldIronforge = dungeonData.find((dungeon) => dungeon.name === 'The Hall of Thanes').quests
    .find((quest) => quest.name === 'Old Ironforge Incursion');
  assert.equal(oldIronforge.questId, 96393);
  assert.equal(Object.hasOwn(oldIronforge, 'url'), false);
  const oldIronforgeCardQuest = [...hallCard.querySelectorAll('.dungeon-card-quests li')]
    .find((quest) => quest.textContent.includes('Old Ironforge Incursion'));
  assert.equal(oldIronforgeCardQuest.querySelector('a').href, 'https://www.wowhead.com/forever/quest=96393');

  const startValue = document.querySelector('#start-value');
  startValue.value = '13';
  dispatch(window, startValue, 'input');
  const routeHall = [...document.querySelectorAll('.route-step')]
    .find((step) => step.querySelector('h3').textContent.includes('The Hall of Thanes'));
  assert.equal(routeHall.querySelector('h3 a').href, dungeonLink.href);
  const oldIronforgeRouteQuest = [...routeHall.querySelectorAll('li')]
    .find((quest) => quest.textContent.includes('Old Ironforge Incursion'));
  assert.equal(oldIronforgeRouteQuest.querySelector('a').href, 'https://www.wowhead.com/forever/quest=96393');

  const currentHallCard = [...document.querySelectorAll('.dungeon-card')]
    .find((card) => card.querySelector('h3').textContent.includes('The Hall of Thanes'));
  currentHallCard.querySelector('.edit-dungeon-btn').click();
  const dungeonUrl = document.querySelector('.dungeon-url');
  assert.equal(dungeonUrl.value, dungeonLink.href);
  const questId = document.querySelector('.quest-row[data-quest-index="0"] .quest-id');
  assert.equal(questId.value, '96403');
  questId.value = '-1';
  dispatch(window, questId, 'input');
  document.querySelector('.save-dungeon-btn').click();
  const savedHall = [...document.querySelectorAll('.dungeon-card')]
    .find((card) => card.querySelector('h3').textContent.includes('The Hall of Thanes'));
  assert.equal(savedHall.querySelector('.dungeon-card-quests li:nth-child(1) a'), null);
  const savedOldIronforgeQuest = [...savedHall.querySelectorAll('.dungeon-card-quests li')]
    .find((quest) => quest.textContent.includes('Old Ironforge Incursion'));
  assert.equal(savedOldIronforgeQuest.querySelector('a').href, 'https://www.wowhead.com/forever/quest=96393');
});

test('starts with an empty route and adds a custom dungeon for editing', async () => {
  const { window, document } = await loadPlanner('http://localhost/foreverguide/', false);
  assert.equal(document.querySelectorAll('.dungeon-card').length, 0);
  assert.equal(document.querySelectorAll('.pool-item[draggable="true"]').length > 0, true);
  document.querySelector('#add-dungeon-btn').click();
  assert.equal(document.querySelectorAll('.dungeon-card').length, 1);
  assert.ok(document.querySelector('.dungeon-card.is-editing'));
  assert.equal(window.lastScrolledElement, document.querySelector('.dungeon-card.is-editing'));
  assert.equal(document.activeElement, document.querySelector('.dungeon-name'));

  document.querySelector('#calculate-btn').click();
  assert.equal(document.querySelector('#route-editor').hidden, false);
});

test('exports and imports route JSON without URL sharing', async () => {
  const { window, document } = await loadPlanner();
  assert.equal(document.querySelector('#share-route-btn, #route-share-btn'), null);

  document.querySelector('.edit-dungeon-btn[data-index="0"]').click();
  const prerequisite = document.querySelector('.dungeon-dependencies option[value="Ruins of Lordaeron"]');
  prerequisite.selected = true;
  dispatch(window, document.querySelector('.dungeon-dependencies'), 'change');
  document.querySelector('.save-dungeon-btn').click();

  const startMode = document.querySelector('#start-mode');
  startMode.value = 'xp';
  dispatch(window, startMode, 'change');
  const startValue = document.querySelector('#start-value');
  startValue.value = '30000';
  dispatch(window, startValue, 'input');
  const faction = document.querySelector('#faction');
  faction.value = 'Horde';
  dispatch(window, faction, 'change');

  document.querySelector('#export-pool-btn').click();
  assert.equal(window.downloadedFile, 'foreverguide-route.json');
  assert.match(document.querySelector('#import-export-status').textContent, /exported/i);
  const exported = JSON.parse(window.exportPoolJson());
  assert.equal(exported.startMode, 'xp');
  assert.equal(exported.startValue, 30000);
  assert.equal(exported.faction, 'Horde');
  assert.equal(exported.route.length, dungeonData.length);
  assert.deepEqual(exported.route[0].dependencies, [{ dungeonName: 'Ruins of Lordaeron' }]);

  const fileInput = document.querySelector('#import-pool-file');
  const status = document.querySelector('#import-export-status');
  Object.defineProperty(fileInput, 'files', {
    configurable: true,
    value: [new window.File([JSON.stringify(exported)], 'foreverguide-pool.json', { type: 'application/json' })],
  });
  status.textContent = '';
  await new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Import did not finish')), 1000);
    const observer = new window.MutationObserver(() => {
      if (!status.textContent) return;
      observer.disconnect();
      window.clearTimeout(timeout);
      resolve();
    });
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    document.querySelector('#import-pool-btn').click();
    dispatch(window, fileInput, 'change');
  });

  assert.match(status.textContent, /Imported route with 18 dungeons/);
  assert.equal(document.querySelector('#start-mode').value, 'xp');
  assert.equal(document.querySelector('#start-value').value, '30000');
  assert.equal(document.querySelector('#faction').value, 'Horde');
  assert.match(document.querySelector('.dungeon-card[data-index="0"] .dungeon-card-dependencies').textContent, /Requires completion of: Ruins of Lordaeron/);
});

test('exports a RestedXP Forever companion addon with quest steps and waypoints', async () => {
  const { window, document } = await loadPlanner('http://localhost/foreverguide/', false);
  const firstQuest = questCatalogData.quests.find((entry) => entry.questId === 7);
  const secondQuest = structuredClone(questCatalogData.quests.find((entry) => entry.questId === 9));
  secondQuest.objectiveSteps = [{
    index: 1,
    text: 'Kill a Deeprun Rat',
    locations: [{ name: 'Deeprun Rat', zones: [{ zone: 'Deeprun Tram', coordinates: [[-1, -1]] }] }],
  }];
  window.importPoolJson(JSON.stringify({
    startMode: 'level',
    startValue: 10,
    faction: 'Alliance',
    route: [{ name: 'Custom dungeon', levelRange: '1-10', quests: [firstQuest, secondQuest] }],
  }));

  document.querySelector('#export-rxp-btn').click();
  assert.equal(window.downloadedFile, 'foreverguide-rxp-route-alliance.zip');
  assert.match(document.querySelector('#rxp-export-status').textContent, /downloaded/i);

  const archive = window.ForeverguideRXPExport.createAddonArchive(JSON.parse(window.exportPoolJson()).route, 'Alliance', 10);
  assert.equal(Buffer.from(archive.bytes).readUInt32LE(0), 0x04034b50);
  const files = readStoredZip(archive.bytes);
  const toc = files.get('Foreverguide_RestedXP/Foreverguide_RestedXP.toc');
  const guide = files.get('Foreverguide_RestedXP/Foreverguide_RestedXP.lua');
  const readme = files.get('Foreverguide_RestedXP/README.txt');
  assert.match(toc, /## Interface: 16001/);
  assert.match(toc, /## Dependencies: RXPGuides/);
  assert.ok(guide);
  assert.match(archive.guide, /#forever/);
  assert.match(archive.guide, /\.goto Elwynn Forest,48\.92,41\.61/);
  assert.match(archive.guide, /\.accept 7/);
  assert.match(archive.guide, /\.complete 7,1/);
  assert.match(archive.guide, /\.turnin 7/);
  assert.match(archive.guide, /Kobold Vermin/);
  assert.doesNotMatch(archive.guide, /\.goto Deeprun Tram,-1,-1/);
  const guideLines = archive.guide.split('\n');
  const stepIndex = (pattern) => guideLines.findIndex((line) => pattern.test(line));
  assert.ok(stepIndex(/^\.accept 7/) < stepIndex(/^\.accept 9/));
  assert.ok(stepIndex(/^\.accept 9/) < stepIndex(/^\.complete 7,/));
  assert.ok(stepIndex(/^\.complete 7,/) < stepIndex(/^\.complete 9,/));
  assert.ok(stepIndex(/^\.complete 9,/) < stepIndex(/^\.turnin 7/));
  assert.ok(stepIndex(/^\.turnin 7/) < stepIndex(/^\.turnin 9/));
  assert.match(readme, /Interface\/AddOns/);
});

test('discloses Questie and RestedXP attribution', () => {
  assert.match(html, /Quest names, requirements, and location data are sourced from/);
  assert.match(html, /restedxp\.com/);
  assert.match(html, /not affiliated with or endorsed by RestedXP/);
});