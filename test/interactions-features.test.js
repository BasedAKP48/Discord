const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const {
  EPHEMERAL,
  NO_TEXT,
  buildInteractionMessage,
  createInteractionHandler,
  createRelay,
} = require('../src/interactions');

let relay;

const arg = (overrides = {}) => ({
  name: 'target', description: 'Who or what', type: 'string', ...overrides,
});
const plans = Array.from({ length: 40 }, (_, i) => ({ name: `Plan ${i}`, value: `plan-${i}` }));

const commands = new Map([
  ['balance', {
    name: 'balance', online: true, args: [arg({ name: 'currency' })],
  }],
  ['voucher-buy', {
    name: 'voucher-buy',
    online: true,
    private: true,
    group: 'voucher',
    args: [arg({ name: 'plan', autocomplete: true, choices: plans }), arg({ name: 'file', type: 'attachment' })],
  }],
  ['voucher-mine', {
    name: 'voucher-mine',
    online: true,
    private: true,
    args: [arg({ name: 'target', type: 'user' })],
    context: { type: 'user', arg: 'target' },
  }],
  ['remind-me', {
    name: 'remind-me',
    online: true,
    args: [arg({ name: 'text' })],
    context: { type: 'message', arg: 'text', name: 'Remind me' },
  }],
  ['gone', {
    name: 'gone',
    online: false,
    args: [arg({ name: 'target', type: 'user' })],
    context: { type: 'user', arg: 'target' },
  }],
]);

const createInteraction = (id, overrides = {}) => {
  const calls = [];
  const record = name => async (...args) => {
    calls.push([name, ...args]);
  };
  return {
    id,
    type: 2,
    calls,
    defer: record('defer'),
    createMessage: record('createMessage'),
    result: record('result'),
    ...overrides,
  };
};

const createHandler = () => {
  const sent = [];
  const handle = createInteractionHandler({
    relay,
    getCommands: () => commands,
    send: async (message) => { sent.push(message); },
    buildMessage: (interaction, text, parsed) => ({ text, interactionId: interaction.id, parsed }),
  });
  return { handle, sent };
};

const messages = (list) => {
  const map = new Map(list.map(item => [item.id, item]));
  return map;
};

beforeEach(() => {
  relay = createRelay({
    timeout: 1000, keep: 5000, setTimer: () => 0, clearTimer: () => {},
  });
});

test('a subcommand runs the command it stands for, with its own options', async () => {
  const { handle, sent } = createHandler();
  const interaction = createInteraction('s1', {
    data: {
      type: 1,
      name: 'voucher',
      options: [{ type: 1, name: 'buy', options: [{ name: 'plan', value: 'plan-3' }] }],
    },
  });

  await handle(interaction);

  assert.deepEqual(interaction.calls, [['defer', EPHEMERAL]]);
  assert.deepEqual(sent, [{
    text: '.voucher-buy plan-3',
    interactionId: 's1',
    parsed: { command: 'voucher-buy', args: { plan: 'plan-3' } },
  }]);
});

test('a subcommand that does not exist any more is told so privately', async () => {
  const { handle, sent } = createHandler();
  const interaction = createInteraction('s2', {
    data: { type: 1, name: 'voucher', options: [{ type: 1, name: 'refund' }] },
  });

  await handle(interaction);

  assert.deepEqual(interaction.calls, [['createMessage', { content: 'That command does not exist any more.', flags: EPHEMERAL }]]);
  assert.equal(sent.length, 0);
});

test('an attachment in a command reaches the plugin as a description of the file', async () => {
  const { handle, sent } = createHandler();
  const interaction = createInteraction('a1', {
    data: {
      type: 1,
      name: 'voucher',
      options: [{ type: 1, name: 'buy', options: [{ name: 'file', value: 'f1' }] }],
      resolved: { attachments: { f1: { id: 'f1', url: 'https://cdn.test/f.png', filename: 'f.png' } } },
    },
  });

  await handle(interaction);

  assert.equal(sent[0].text, '.voucher-buy https://cdn.test/f.png');
  assert.deepEqual(sent[0].parsed.args, { file: { id: 'f1', url: 'https://cdn.test/f.png', filename: 'f.png' } });
});

test('a user menu runs the command with the user that was clicked', async () => {
  const { handle, sent } = createHandler();
  const interaction = createInteraction('m1', {
    data: { type: 2, name: 'Voucher mine', target_id: '555' },
  });

  await handle(interaction);

  assert.deepEqual(interaction.calls, [['defer', EPHEMERAL]]);
  assert.equal(relay.has('m1'), true);
  assert.deepEqual(sent, [{
    text: '.voucher-mine 555',
    interactionId: 'm1',
    parsed: {
      command: 'voucher-mine',
      args: { target: '555' },
      target: { type: 'user', id: '555' },
    },
  }]);
});

test('a message menu runs the command with the text of the message and says who wrote it', async () => {
  const { handle, sent } = createHandler();
  const interaction = createInteraction('m2', {
    type: 2,
    data: {
      type: 3,
      name: 'Remind me',
      target_id: 'msg1',
      resolved: { messages: messages([{ id: 'msg1', content: 'buy milk', author: { id: 'u9' } }]) },
    },
  });

  await handle(interaction);

  assert.deepEqual(interaction.calls, [['defer', 0]]);
  assert.deepEqual(sent[0].parsed, {
    command: 'remind-me',
    args: { text: 'buy milk' },
    target: { type: 'message', id: 'msg1', authorId: 'u9' },
  });
  assert.equal(sent[0].text, '.remind-me buy milk');
});

test('a message with no text is not sent on, and the person is told', async () => {
  const { handle, sent } = createHandler();
  const empty = createInteraction('m3', {
    data: {
      type: 3,
      name: 'Remind me',
      target_id: 'msg2',
      resolved: { messages: messages([{ id: 'msg2', content: '', author: { id: 'u9' } }]) },
    },
  });
  const unknown = createInteraction('m4', {
    data: {
      type: 3, name: 'Remind me', target_id: 'msg3', resolved: { messages: messages([]) },
    },
  });

  await handle(empty);
  await handle(unknown);

  assert.deepEqual(empty.calls, [['createMessage', { content: NO_TEXT, flags: EPHEMERAL }]]);
  assert.deepEqual(unknown.calls, [['createMessage', { content: NO_TEXT, flags: EPHEMERAL }]]);
  assert.equal(sent.length, 0);
  assert.equal(relay.has('m3') || relay.has('m4'), false);
});

test('a menu that does not exist any more, or whose plugin is away, is told so privately', async () => {
  const { handle, sent } = createHandler();
  const missing = createInteraction('m5', { data: { type: 2, name: 'Nothing', target_id: '1' } });
  const away = createInteraction('m6', { data: { type: 2, name: 'Gone', target_id: '1' } });

  await handle(missing);
  await handle(away);

  assert.deepEqual(missing.calls, [['createMessage', { content: 'That command does not exist any more.', flags: EPHEMERAL }]]);
  assert.deepEqual(away.calls, [['createMessage', { content: 'That command is not available right now.', flags: EPHEMERAL }]]);
  assert.equal(sent.length, 0);
});

test('a menu of one type is not found by a menu name of the other type', async () => {
  const { handle, sent } = createHandler();
  const interaction = createInteraction('m7', { data: { type: 3, name: 'Voucher mine', target_id: '1' } });

  await handle(interaction);

  assert.equal(interaction.calls[0][0], 'createMessage');
  assert.equal(sent.length, 0);
});

test('autocomplete answers with the choices that match, from the stored list', async () => {
  const { handle, sent } = createHandler();
  const interaction = createInteraction('t1', {
    type: 4,
    data: {
      type: 1,
      name: 'voucher',
      options: [{ type: 1, name: 'buy', options: [{ name: 'plan', value: 'plan 3', focused: true }] }],
    },
  });

  await handle(interaction);

  assert.equal(interaction.calls.length, 1);
  assert.equal(interaction.calls[0][0], 'result');
  assert.deepEqual(interaction.calls[0][1].map(item => item.value).slice(0, 2), ['plan-3', 'plan-30']);
  assert.equal(sent.length, 0);
  assert.equal(relay.has('t1'), false);
});

test('autocomplete for something it does not know answers with nothing, and never leaves Discord waiting', async () => {
  const { handle } = createHandler();
  const interaction = createInteraction('t2', {
    type: 4,
    data: { type: 1, name: 'nothing', options: [{ name: 'x', value: 'p', focused: true }] },
  });

  await handle(interaction);

  assert.deepEqual(interaction.calls, [['result', []]]);
});

test('an autocomplete with no data is left alone', async () => {
  const { handle } = createHandler();
  const interaction = createInteraction('t3', { type: 4, data: undefined });

  await handle(interaction);

  assert.deepEqual(interaction.calls, []);
});

const describeUser = {
  member: {
    nick: 'Alan',
    user: {
      id: 'u2', username: 'alan', discriminator: '0', bot: false,
    },
  },
  guildID: 'g1',
  channel: { id: 'ch1', name: 'general', guild: { name: 'Guild' } },
};

test('the message to the plugin names what a menu was used on, and only then', () => {
  const info = { cid: 'discord', botName: 'bot#1' };
  const interaction = { id: 'i1', ...describeUser };

  const withTarget = buildInteractionMessage(interaction, '.x', info, {
    command: 'x', args: {}, target: { type: 'user', id: '555' },
  });
  const without = buildInteractionMessage(interaction, '.x', info, { command: 'x', args: {} });

  assert.deepEqual(withTarget.data.target, { type: 'user', id: '555' });
  assert.equal('target' in without.data, false);
  assert.equal(Object.values(withTarget.data).some(value => value === undefined), false);
});
