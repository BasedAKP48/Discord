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
