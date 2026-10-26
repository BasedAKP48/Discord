const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const {
  EPHEMERAL,
  NO_RESPONSE,
  buildInteractionMessage,
  createInteractionHandler,
  createRelay,
} = require('../src/interactions');

let timers;
let errors;
let relay;

const createTimers = () => {
  const list = new Map();
  let next = 0;
  return {
    setTimer: (fn, ms) => {
      next += 1;
      list.set(next, { fn, ms });
      return next;
    },
    clearTimer: id => list.delete(id),
    fire: ms => [...list.entries()]
      .filter(([, timer]) => timer.ms === ms)
      .forEach(([id, timer]) => {
        list.delete(id);
        timer.fn();
      }),
    count: () => list.size,
  };
};

const createInteraction = (id = 'i1', overrides = {}) => {
  const calls = [];
  const record = (name, fail) => async (...args) => {
    calls.push([name, ...args]);
    if (fail) throw new Error(`${name} failed`);
    return undefined;
  };
  return {
    id,
    type: 2,
    data: { type: 1, name: 'balance', options: [] },
    calls,
    defer: record('defer'),
    createMessage: record('createMessage'),
    createFollowup: record('createFollowup'),
    editOriginalMessage: record('editOriginalMessage'),
    deleteOriginalMessage: record('deleteOriginalMessage'),
    ...overrides,
  };
};

beforeEach(() => {
  timers = createTimers();
  errors = [];
  relay = createRelay({
    timeout: 1000,
    keep: 5000,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    onError: error => errors.push(error.message),
  });
});

test('the first reply replaces the thinking message', async () => {
  const interaction = createInteraction();
  relay.track(interaction);

  assert.equal(await relay.reply('i1', { content: 'Your balance: 5' }), true);

  assert.deepEqual(interaction.calls, [['editOriginalMessage', { content: 'Your balance: 5' }]]);
});

test('later replies are follow-ups, in the order they arrived', async () => {
  const interaction = createInteraction();
  relay.track(interaction);

  await Promise.all([
    relay.reply('i1', { content: 'one' }),
    relay.reply('i1', { content: 'two' }),
    relay.reply('i1', { content: 'three' }),
  ]);

  assert.deepEqual(interaction.calls.map(([name, content]) => `${name}:${content.content}`), [
    'editOriginalMessage:one',
    'createFollowup:two',
    'createFollowup:three',
  ]);
});

test('a private reply to a public thinking message is deleted and sent privately', async () => {
  const interaction = createInteraction();
  relay.track(interaction, { ephemeral: false });

  await relay.reply('i1', { content: 'secret' }, { private: true });

  assert.deepEqual(interaction.calls, [
    ['deleteOriginalMessage'],
    ['createFollowup', { content: 'secret', flags: EPHEMERAL }],
  ]);
});

test('a private reply to an already private thinking message just edits it', async () => {
  const interaction = createInteraction();
  relay.track(interaction, { ephemeral: true });

  await relay.reply('i1', { content: 'secret' }, { private: true });

  assert.deepEqual(interaction.calls, [['editOriginalMessage', { content: 'secret' }]]);
});

test('a later private reply is an ephemeral follow-up', async () => {
  const interaction = createInteraction();
  relay.track(interaction, { ephemeral: false });

  await relay.reply('i1', { content: 'public' });
  await relay.reply('i1', { content: 'secret' }, { private: true });

  assert.deepEqual(interaction.calls[1], ['createFollowup', { content: 'secret', flags: EPHEMERAL }]);
});

test('an unknown interaction is not answered', async () => {
  assert.equal(relay.has('nope'), false);
  assert.equal(await relay.reply('nope', { content: 'x' }), false);
});

test('a command nobody answers is told so, once, and then forgotten', async () => {
  const interaction = createInteraction();
  relay.track(interaction);

  timers.fire(1000);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(interaction.calls, [['editOriginalMessage', { content: NO_RESPONSE }]]);
  assert.equal(relay.has('i1'), false);
  assert.equal(await relay.reply('i1', { content: 'too late' }), false);
});

test('an answered command is not told that it got no response', async () => {
  const interaction = createInteraction();
  relay.track(interaction);

  await relay.reply('i1', { content: 'ok' });
  timers.fire(1000);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(interaction.calls.length, 1);
  assert.equal(relay.has('i1'), true);
});

test('an answered command is forgotten after a while, and leaves no timers behind', async () => {
  relay.track(createInteraction());
  await relay.reply('i1', { content: 'ok' });
  assert.equal(timers.count(), 1);

  timers.fire(5000);

  assert.equal(relay.has('i1'), false);
  assert.equal(timers.count(), 0);
});

test('failures are reported and do not stop later replies', async () => {
  const interaction = createInteraction('i1', {
    editOriginalMessage: async () => { throw new Error('token expired'); },
  });
  relay.track(interaction);

  assert.equal(await relay.reply('i1', { content: 'a' }), true);
  assert.equal(await relay.reply('i1', { content: 'b' }), true);

  assert.deepEqual(errors, ['token expired']);
  assert.deepEqual(interaction.calls, [['createFollowup', { content: 'b' }]]);
});

const commands = new Map([
  ['balance', {
    name: 'balance', args: [{ name: 'currency' }], online: true, private: true,
  }],
  ['say', {
    name: 'say', args: [{ name: 'text' }], online: true,
  }],
  ['gone', { name: 'gone', online: false }],
]);

const createHandler = () => {
  const sent = [];
  const handle = createInteractionHandler({
    relay,
    getCommands: () => commands,
    send: async (message) => { sent.push(message); },
    buildMessage: (interaction, text) => ({ text, interactionId: interaction.id }),
  });
  return { handle, sent };
};

test('a private command defers privately, is tracked, and is sent as text', async () => {
  const { handle, sent } = createHandler();
  const interaction = createInteraction('i1', {
    data: { type: 1, name: 'balance', options: [{ name: 'currency', value: 'GEM' }] },
  });

  await handle(interaction);

  assert.deepEqual(interaction.calls, [['defer', EPHEMERAL]]);
  assert.equal(relay.has('i1'), true);
  assert.deepEqual(sent, [{ text: '.balance GEM', interactionId: 'i1' }]);
});

test('a public command defers publicly', async () => {
  const { handle, sent } = createHandler();
  const interaction = createInteraction('i2', {
    data: { type: 1, name: 'say', options: [{ name: 'text', value: 'hello there' }] },
  });

  await handle(interaction);

  assert.deepEqual(interaction.calls, [['defer', 0]]);
  assert.equal(sent[0].text, '.say hello there');
});

test('a command that is gone or offline is answered privately and never sent', async () => {
  const { handle, sent } = createHandler();
  const missing = createInteraction('i3', { data: { type: 1, name: 'removed' } });
  const offline = createInteraction('i4', { data: { type: 1, name: 'gone' } });

  await handle(missing);
  await handle(offline);

  assert.deepEqual(missing.calls, [['createMessage', { content: 'That command does not exist any more.', flags: EPHEMERAL }]]);
  assert.deepEqual(offline.calls, [['createMessage', { content: 'That command is not available right now.', flags: EPHEMERAL }]]);
  assert.equal(sent.length, 0);
  assert.equal(relay.has('i3') || relay.has('i4'), false);
});

test('anything that is not a chat input command is ignored', async () => {
  const { handle, sent } = createHandler();
  const component = createInteraction('i5', { type: 3 });
  const userMenu = createInteraction('i6', { data: { type: 2, name: 'balance' } });
  const noData = createInteraction('i7', { data: undefined });

  await handle(component);
  await handle(userMenu);
  await handle(noData);

  assert.equal(component.calls.length + userMenu.calls.length + noData.calls.length, 0);
  assert.equal(sent.length, 0);
});

test('a failure to send is passed on, and the unanswered command still times out', async () => {
  const handle = createInteractionHandler({
    relay,
    getCommands: () => commands,
    send: async () => { throw new Error('database unavailable'); },
    buildMessage: (interaction, text) => ({ text }),
  });
  const interaction = createInteraction('i8', { data: { type: 1, name: 'say' } });

  await assert.rejects(handle(interaction), /database unavailable/);
  timers.fire(1000);
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(interaction.calls.map(([name]) => name), ['defer', 'editOriginalMessage']);
});

const context = { cid: 'fmbot-cid', connectorName: 'Main', botName: 'fmbot#0' };

test('a command run in a server describes the sender like a normal message does', () => {
  const interaction = createInteraction('i9', {
    guildID: 'g1',
    channel: {
      id: 'c1', name: 'general', parentID: 'cat1', guild: { id: 'g1', name: 'My Server' },
    },
    member: {
      nick: 'Nick',
      user: {
        id: 'u1', username: 'alan', discriminator: '0', bot: false,
      },
    },
  });

  const message = buildInteractionMessage(interaction, '.balance GEM', context);

  assert.equal(message.text, '.balance GEM');
  assert.equal(message.type, 'text');
  assert.equal(message.cid, 'fmbot-cid');
  assert.equal(message.uid, 'u1');
  assert.equal(message.channel, 'c1');
  assert.equal(typeof message.timeReceived, 'number');
  assert.deepEqual(message.data, {
    channel: '#general',
    source: 'alan#0',
    sourceIsBot: false,
    nick: 'Nick',
    serverID: 'g1',
    parentID: 'cat1',
    server: 'My Server',
    connectorType: 'discord',
    connectorName: 'Main',
    connectorBotName: 'fmbot#0',
    isPM: null,
    interactionId: 'i9',
  });
});

test('a command run in a direct message is marked as one and has no server', () => {
  const interaction = createInteraction('i10', {
    channel: { id: 'dm1' },
    user: {
      id: 'u2', username: 'sam', discriminator: '0', bot: false,
    },
  });

  const { data, uid } = buildInteractionMessage(interaction, '.balance', context);

  assert.equal(uid, 'u2');
  assert.equal(data.isPM, true);
  assert.equal(data.channel, '#DirectMessage');
  assert.equal(data.server, 'DirectMessage');
  assert.equal(data.serverID, null);
  assert.equal(data.parentID, null);
  assert.equal(data.nick, 'sam');
});

test('a sender without a nickname falls back to the username, and a missing bot name stays null', () => {
  const interaction = createInteraction('i11', {
    guildID: 'g1',
    channel: { id: 'c1', name: 'general', guild: { id: 'g1', name: 'S' } },
    member: {
      nick: null,
      user: {
        id: 'u3', username: 'kim', discriminator: '1234', bot: false,
      },
    },
  });

  const { data } = buildInteractionMessage(interaction, '.x', { cid: 'c', botName: 'b#0' });

  assert.equal(data.nick, 'kim');
  assert.equal(data.connectorName, null);
  assert.equal(data.source, 'kim#1234');
});

test('the message carries no undefined values, which the database would refuse', () => {
  const interaction = createInteraction('i12', {
    guildID: 'g1',
    channel: { id: 'c1', name: 'general', guild: { id: 'g1', name: 'S' } },
    member: {
      nick: undefined,
      user: {
        id: 'u4', username: 'lee', discriminator: '0', bot: false,
      },
    },
  });

  const message = buildInteractionMessage(interaction, '.x', context);
  const walk = value => Object.values(value).every(v => v !== undefined
    && (v === null || typeof v !== 'object' || walk(v)));

  assert.equal(walk(message), true);
});

test('a command that is not allowed where it was run is refused privately and never sent', async () => {
  const sent = [];
  const handle = createInteractionHandler({
    relay,
    getCommands: () => commands,
    send: async (message) => { sent.push(message); },
    buildMessage: (interaction, text) => ({ text, data: { serverID: interaction.guildID } }),
    isAllowed: (command, message) => message.data.serverID === 'g1',
  });
  const refused = createInteraction('i20', { guildID: 'g2', data: { type: 1, name: 'say' } });
  const allowed = createInteraction('i21', { guildID: 'g1', data: { type: 1, name: 'say' } });

  await handle(refused);
  await handle(allowed);

  assert.deepEqual(refused.calls, [['createMessage', { content: 'That command is not available here.', flags: EPHEMERAL }]]);
  assert.equal(relay.has('i20'), false);
  assert.deepEqual(allowed.calls.map(([name]) => name), ['defer']);
  assert.equal(sent.length, 1);
});

test('the check is given the command and the message the plugins would see', async () => {
  const seen = [];
  const handle = createInteractionHandler({
    relay,
    getCommands: () => commands,
    send: async () => {},
    buildMessage: (interaction, text) => ({ text }),
    isAllowed: (command, message) => { seen.push([command.name, message.text]); return true; },
  });

  await handle(createInteraction('i22', {
    data: { type: 1, name: 'say', options: [{ name: 'text', value: 'hello' }] },
  }));

  assert.deepEqual(seen, [['say', '.say hello']]);
});
