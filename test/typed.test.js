const assert = require('node:assert/strict');
const { test } = require('node:test');

const { readTyped } = require('../src/typed');

const commands = new Map([
  ['balance', {
    name: 'balance', args: [{ name: 'currency' }], online: true, discord: { dmPermission: false },
  }],
  ['gone', { name: 'gone', online: false }],
]);

const seen = [];
const parse = (text, list, options) => {
  seen.push({ text, names: list.map(command => command.name), options });
  const match = /^\.(\w+)\s*(\S*)/.exec(text);
  if (!match) return null;
  const command = list.find(item => item.name === match[1]);
  if (!command) return null;
  return match[2] === '!' ? { command, problem: 'currency is wrong' } : { command, args: match[2] ? { currency: match[2] } : {} };
};
const usage = (command, prefix) => `${prefix}${command.name} [currency]`;

const message = (text, data = {}) => ({
  type: 'text', text, uid: '1', cid: 'c', channel: '5', data: { connectorType: 'discord', ...data },
});
const read = (text, data, options = {}) => readTyped(message(text, data), {
  commands, parse, usage, prefix: '.', ...options,
});

test('typed text that names a command becomes a command message with its arguments', () => {
  const result = read('.balance GEM', { serverID: 'g1' });

  assert.equal(result.message.type, 'command');
  assert.equal(result.message.text, '.balance GEM');
  assert.equal(result.message.uid, '1');
  assert.deepEqual(result.message.data, {
    connectorType: 'discord', serverID: 'g1', command: 'balance', args: { currency: 'GEM' },
  });
});

test('only commands that are online are offered to the parser', () => {
  seen.length = 0;
  read('.gone');

  assert.deepEqual(seen[0].names, ['balance']);
  assert.equal(read('.gone'), null);
});

test('private messages are read without the prefix, channels are not', () => {
  seen.length = 0;
  read('balance', { isPM: true });
  read('balance', { isPM: null });

  assert.deepEqual(seen.map(call => call.options), [
    { prefix: '.', direct: true },
    { prefix: '.', direct: false },
  ]);
});

test('text that is not a command is left alone', () => {
  assert.equal(read('hello there'), null);
  assert.equal(read('.nothing'), null);
});

test('messages that are not typed text are left alone', () => {
  const other = { ...message('.balance'), type: 'join' };

  assert.equal(readTyped(other, {
    commands, parse, usage, prefix: '.',
  }), null);
});

test('a command that is not allowed here is left as plain text', () => {
  const isAllowed = (command, msg) => !(msg.data.isPM && command.discord.dmPermission === false);

  assert.equal(read('.balance', { isPM: true }, { isAllowed }), null);
  assert.equal(read('.balance', { serverID: 'g1' }, { isAllowed }).message.type, 'command');
});

test('a command with bad arguments gets the problem and the usage as a reply', () => {
  assert.deepEqual(read('.balance !'), { reply: 'currency is wrong. Usage: .balance [currency]' });
});

test('the original message is not changed', () => {
  const original = message('.balance GEM');
  readTyped(original, {
    commands, parse, usage, prefix: '.',
  });

  assert.equal(original.type, 'text');
  assert.equal('command' in original.data, false);
});
