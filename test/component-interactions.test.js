const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const {
  EPHEMERAL,
  NO_BUTTON_RESPONSE,
  buildComponentMessage,
  createComponentHandler,
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
  };
};

const createClick = (id = 'c1', overrides = {}) => {
  const calls = [];
  const record = name => async (...args) => {
    calls.push([name, ...args]);
  };
  return {
    id,
    type: 3,
    data: { component_type: 2, custom_id: 'btn:vouchers:confirm' },
    guildID: 'g1',
    channel: {
      id: 'ch1', name: 'general', parentID: null, guild: { name: 'Guild' },
    },
    member: {
      nick: 'Alan',
      user: {
        id: 'u2', username: 'alan', discriminator: '0', bot: false,
      },
    },
    message: { id: 'm1', interaction: { user: { id: 'u1' } } },
    calls,
    deferUpdate: record('deferUpdate'),
    createFollowup: record('createFollowup'),
    editOriginalMessage: record('editOriginalMessage'),
    deleteOriginalMessage: record('deleteOriginalMessage'),
    ...overrides,
  };
};

const settle = () => new Promise(resolve => setImmediate(resolve));

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

test('the first reply to a click edits the message the button is on, and takes its buttons and embed off', async () => {
  const click = createClick();
  relay.track(click, { component: true });

  await relay.reply('c1', { content: 'Bought' });

  assert.deepEqual(click.calls, [
    ['editOriginalMessage', { content: 'Bought', embeds: [], components: [] }],
  ]);
});

test('a reply that brings buttons of its own keeps them, and still replaces the embed', async () => {
  const click = createClick();
  relay.track(click, { component: true });
  const components = [{ type: 1, components: [] }];

  await relay.reply('c1', { content: 'Sure?', components });

  assert.deepEqual(click.calls, [
    ['editOriginalMessage', { content: 'Sure?', components, embeds: [] }],
  ]);
});

test('a reply that brings an embed of its own keeps it, and still takes the buttons off', async () => {
  const click = createClick();
  relay.track(click, { component: true });
  const embeds = [{ title: 'Done' }];

  await relay.reply('c1', { embeds });

  assert.deepEqual(click.calls, [['editOriginalMessage', { embeds, components: [] }]]);
});

test('a private reply that says it updates edits the message, instead of following up', async () => {
  const click = createClick();
  relay.track(click, { component: true });

  await relay.reply('c1', { content: 'secret' }, { private: true, update: true });

  assert.deepEqual(click.calls, [
    ['editOriginalMessage', { content: 'secret', embeds: [], components: [] }],
  ]);
});

test('a later private reply is a follow-up even when it says it updates', async () => {
  const click = createClick();
  relay.track(click, { component: true });

  await relay.reply('c1', { content: 'first' });
  await relay.reply('c1', { content: 'second' }, { private: true, update: true });

  assert.deepEqual(click.calls[1], ['createFollowup', { content: 'second', flags: EPHEMERAL }]);
});

test('saying it updates changes nothing for a command, only for a click', async () => {
  const command = createClick('k1');
  relay.track(command, { ephemeral: false });

  await relay.reply('k1', { content: 'secret' }, { private: true, update: true });

  assert.deepEqual(command.calls, [
    ['deleteOriginalMessage'],
    ['createFollowup', { content: 'secret', flags: EPHEMERAL }],
  ]);
});

test('a private reply to a click is a follow-up, and the message with the buttons stays', async () => {
  const click = createClick();
  relay.track(click, { component: true });

  await relay.reply('c1', { content: 'secret' }, { private: true });

  assert.deepEqual(click.calls, [['createFollowup', { content: 'secret', flags: EPHEMERAL }]]);
});

test('later replies to a click are follow-ups, in order', async () => {
  const click = createClick();
  relay.track(click, { component: true });

  await Promise.all([
    relay.reply('c1', { content: 'one' }),
    relay.reply('c1', { content: 'two' }),
  ]);

  assert.deepEqual(click.calls.map(([name, content]) => `${name}:${content.content}`), [
    'editOriginalMessage:one',
    'createFollowup:two',
  ]);
});

test('a click nobody answers is told so privately, and the message with the buttons is left alone', async () => {
  const click = createClick();
  relay.track(click, { component: true });

  timers.fire(1000);
  await settle();

  assert.deepEqual(click.calls, [['createFollowup', { content: NO_BUTTON_RESPONSE, flags: EPHEMERAL }]]);
  assert.equal(relay.has('c1'), false);
});

test('a click that was answered is not told that it got no response', async () => {
  const click = createClick();
  relay.track(click, { component: true });

  await relay.reply('c1', { content: 'ok' });
  timers.fire(1000);
  await settle();

  assert.equal(click.calls.length, 1);
});

test('a click is described like a command, and says which plugin and button it was', () => {
  const message = buildComponentMessage(createClick(), { cid: 'discord', connectorName: 'Main', botName: 'bot#1' }, { cid: 'vouchers', id: 'confirm' });

  assert.equal(message.type, 'component');
  assert.equal(message.text, 'confirm');
  assert.equal(message.cid, 'discord');
  assert.equal(message.uid, 'u2');
  assert.equal(message.channel, 'ch1');
  assert.deepEqual(message.data, {
    channel: '#general',
    source: 'alan#0',
    sourceIsBot: false,
    nick: 'Alan',
    serverID: 'g1',
    parentID: null,
    server: 'Guild',
    connectorType: 'discord',
    connectorName: 'Main',
    connectorBotName: 'bot#1',
    isPM: null,
    interactionId: 'c1',
    pluginCid: 'vouchers',
    componentId: 'confirm',
    messageId: 'm1',
    invokerId: 'u1',
  });
});

test('the person who ran the command is null when Discord does not say, and nothing is undefined', () => {
  const click = createClick('c1', { message: { id: 'm1' } });

  const { data } = buildComponentMessage(click, { cid: 'discord', botName: 'bot#1' }, { cid: 'p', id: 'go' });

  assert.equal(data.invokerId, null);
  assert.equal(data.connectorName, null);
  assert.equal(Object.values(data).some(value => value === undefined), false);
});

const createHandler = () => {
  const sent = [];
  const handle = createComponentHandler({
    relay,
    send: async (message) => { sent.push(message); },
    buildMessage: (interaction, parsed) => ({ interactionId: interaction.id, parsed }),
  });
  return { handle, sent };
};

test('a click on a plugin\'s button is acknowledged, tracked, and sent on', async () => {
  const { handle, sent } = createHandler();
  const click = createClick();

  assert.equal(await handle(click), true);

  assert.deepEqual(click.calls, [['deferUpdate']]);
  assert.equal(relay.has('c1'), true);
  assert.deepEqual(sent, [{ interactionId: 'c1', parsed: { cid: 'vouchers', id: 'confirm' } }]);
});

test('a click is tracked as a click, so the reply edits the message and does not delete it', async () => {
  const { handle } = createHandler();
  const click = createClick();
  await handle(click);

  await relay.reply('c1', { content: 'done' }, { private: false });

  assert.deepEqual(click.calls[1], [
    'editOriginalMessage',
    { content: 'done', embeds: [], components: [] },
  ]);
});

test('anything that is not a click on a plugin\'s button is left for the others', async () => {
  const { handle, sent } = createHandler();

  assert.equal(await handle(createClick('c1', { type: 2 })), false);
  assert.equal(await handle(createClick('c2', { data: undefined })), false);
  assert.equal(await handle(createClick('c3', { data: { custom_id: 'page:abc:1' } })), false);
  assert.equal(await handle(createClick('c4', { data: { custom_id: 'something-else' } })), false);

  assert.deepEqual(sent, []);
  assert.equal(relay.has('c3'), false);
});
