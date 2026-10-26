const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  MAX_COMMANDS,
  commandText,
  hashCommands,
  toDiscordCommands,
} = require('../src/slash');

const balance = {
  name: 'balance',
  description: 'Check your wallet balance',
  args: [{
    name: 'currency', description: 'Which currency', type: 'string', required: false,
  }],
  discord: { dmPermission: true, unknownSetting: 'ignored' },
  cid: 'p1',
  plugin: '@basedakp48/plugin-wallet',
  online: true,
};

test('a definition becomes a chat input command with typed options', () => {
  const [command] = toDiscordCommands([{
    name: 'roll',
    description: 'Roll dice',
    args: [
      {
        name: 'sides', description: 'How many sides', type: 'integer', required: true,
      },
      { name: 'secret', description: 'Hide the result', type: 'boolean' },
      { name: 'label', description: 'A note', type: 'string' },
    ],
  }]);

  assert.deepEqual(command, {
    name: 'roll',
    description: 'Roll dice',
    type: 1,
    options: [
      {
        name: 'sides', description: 'How many sides', type: 4, required: true,
      },
      {
        name: 'secret', description: 'Hide the result', type: 5, required: false,
      },
      {
        name: 'label', description: 'A note', type: 3, required: false,
      },
    ],
  });
});

test('only the known discord settings are passed on', () => {
  const [command] = toDiscordCommands([balance]);

  assert.equal(command.dmPermission, true);
  assert.equal('unknownSetting' in command, false);
  assert.equal('cid' in command, false);
  assert.equal('plugin' in command, false);
  assert.equal('online' in command, false);
});

test('a command without args has no options', () => {
  const [command] = toDiscordCommands([{ name: 'ping', description: 'Pong' }]);

  assert.deepEqual(command.options, []);
});

test('commands are sorted by name and capped at the limit discord allows', () => {
  const many = Array.from({ length: MAX_COMMANDS + 5 }, (_, i) => ({
    name: `c${String(i).padStart(3, '0')}`, description: 'x',
  })).reverse();

  const payload = toDiscordCommands(many);

  assert.equal(payload.length, MAX_COMMANDS);
  assert.deepEqual(payload.map(c => c.name), payload.map(c => c.name).slice().sort());
  assert.equal(payload[0].name, 'c000');
});

test('building the payload does not change the definitions', () => {
  const before = JSON.stringify(balance);

  toDiscordCommands([balance]);

  assert.equal(JSON.stringify(balance), before);
});

test('the hash changes only when what discord would receive changes', () => {
  const first = hashCommands(toDiscordCommands([balance]));

  assert.equal(hashCommands(toDiscordCommands([{ ...balance, online: false, cid: 'other' }])), first);
  assert.notEqual(hashCommands(toDiscordCommands([{ ...balance, description: 'Changed' }])), first);
  assert.notEqual(hashCommands(toDiscordCommands([])), first);
});

test('options become words in the order the definition lists them', () => {
  const command = {
    name: 'roll',
    args: [{ name: 'sides' }, { name: 'label' }, { name: 'secret' }],
  };
  const options = [
    { name: 'secret', value: true },
    { name: 'sides', value: 20 },
    { name: 'label', value: 'for fun' },
  ];

  assert.equal(commandText('.', command, options), '.roll 20 for fun true');
});

test('options that were not filled in are left out', () => {
  const command = { name: 'balance', args: [{ name: 'currency' }] };

  assert.equal(commandText('.', command, []), '.balance');
  assert.equal(commandText('.', command, undefined), '.balance');
  assert.equal(commandText('.', command, [{ name: 'currency', value: 'GEM' }]), '.balance GEM');
});

test('a command with no args is just its name behind the prefix', () => {
  assert.equal(commandText('!', { name: 'ping' }, [{ name: 'ignored', value: 'x' }]), '!ping');
});

const { GLOBAL, planSync, reconcile } = require('../src/slash');
const { commandGuilds } = require('@basedakp48/plugin-utils');

const cmd = (name, guilds) => ({
  name, description: `The ${name} command`, ...(guilds ? { discord: { guilds } } : {}),
});
const names = payload => payload.map(command => command.name);

test('commands with no server list are registered everywhere, the rest only where they are listed', () => {
  const plan = planSync(
    [cmd('balance'), cmd('feature-bid', ['1']), cmd('feature-add', ['1', '2']), cmd('say', ['*'])],
    { guildsOf: commandGuilds },
  );

  assert.deepEqual(names(plan.global), ['balance', 'say']);
  assert.deepEqual([...plan.guilds.keys()].sort(), ['1', '2']);
  assert.deepEqual(names(plan.guilds.get('1')), ['feature-add', 'feature-bid']);
  assert.deepEqual(names(plan.guilds.get('2')), ['feature-add']);
});

test('server lists are matched as text, and a plan with no scoped commands has no servers', () => {
  assert.deepEqual([...planSync([cmd('a', [7])], { guildsOf: commandGuilds }).guilds.keys()], ['7']);
  assert.equal(planSync([cmd('a')], { guildsOf: commandGuilds }).guilds.size, 0);
});

test('the test server setting puts everything in one server and leaves the global list alone', () => {
  const plan = planSync(
    [cmd('balance'), cmd('feature-bid', ['1'])],
    { commandGuild: '99', guildsOf: commandGuilds },
  );

  assert.equal(plan.global, undefined);
  assert.deepEqual([...plan.guilds.keys()], ['99']);
  assert.deepEqual(names(plan.guilds.get('99')), ['balance', 'feature-bid']);
});

test('the first sync sends everything, including an empty global list', () => {
  const plan = planSync([cmd('feature-bid', ['1'])], { guildsOf: commandGuilds });

  const { updates, clears } = reconcile(plan, new Map());

  assert.deepEqual(updates.map(update => update.target).sort(), ['1', GLOBAL].sort());
  assert.deepEqual(updates.find(update => update.target === GLOBAL).payload, []);
  assert.deepEqual(clears, []);
});

test('only what changed is sent again', () => {
  const first = planSync([cmd('balance'), cmd('feature-bid', ['1'])], { guildsOf: commandGuilds });
  const synced = new Map(reconcile(first, new Map()).updates.map(u => [u.target, u.hash]));

  const same = reconcile(first, synced);
  assert.deepEqual(same, { updates: [], clears: [] });

  const changed = planSync(
    [cmd('balance'), { ...cmd('feature-bid', ['1']), description: 'New text' }],
    { guildsOf: commandGuilds },
  );
  const { updates } = reconcile(changed, synced);
  assert.deepEqual(updates.map(update => update.target), ['1']);
});

test('a server that no command is listed for any more is emptied', () => {
  const before = planSync([cmd('feature-bid', ['1', '2'])], { guildsOf: commandGuilds });
  const synced = new Map(reconcile(before, new Map()).updates.map(u => [u.target, u.hash]));

  const after = planSync([cmd('feature-bid', ['1'])], { guildsOf: commandGuilds });

  assert.deepEqual(reconcile(after, synced).clears, ['2']);
});

test('moving a command from one server to global empties the server and fills the global list', () => {
  const before = planSync([cmd('feature-bid', ['1'])], { guildsOf: commandGuilds });
  const synced = new Map(reconcile(before, new Map()).updates.map(u => [u.target, u.hash]));

  const after = planSync([cmd('feature-bid')], { guildsOf: commandGuilds });
  const { updates, clears } = reconcile(after, synced);

  assert.deepEqual(clears, ['1']);
  assert.deepEqual(updates.map(update => update.target), [GLOBAL]);
  assert.deepEqual(names(updates[0].payload), ['feature-bid']);
});

test('switching the test server off clears it and brings the global list back', () => {
  const dev = planSync([cmd('balance')], { commandGuild: '99', guildsOf: commandGuilds });
  const synced = new Map(reconcile(dev, new Map()).updates.map(u => [u.target, u.hash]));
  assert.equal(synced.has(GLOBAL), false);

  const normal = planSync([cmd('balance')], { guildsOf: commandGuilds });
  const { updates, clears } = reconcile(normal, synced);

  assert.deepEqual(clears, ['99']);
  assert.deepEqual(updates.map(update => update.target), [GLOBAL]);
});

test('the global list is never emptied by the test server setting', () => {
  const normal = planSync([cmd('balance')], { guildsOf: commandGuilds });
  const synced = new Map(reconcile(normal, new Map()).updates.map(u => [u.target, u.hash]));

  const dev = planSync([cmd('balance')], { commandGuild: '99', guildsOf: commandGuilds });
  const { clears } = reconcile(dev, synced);

  assert.deepEqual(clears, []);
});
