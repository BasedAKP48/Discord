const assert = require('node:assert/strict');
const { beforeEach, test } = require('node:test');

const edit = require('../internal/messageedit.command');
const post = require('../internal/messagepost.command');
const { MAX_TEXT, content, discordError } = require('../internal/messages');

let calls;
let failure;

const discord = {
  createMessage: async (channel, body) => {
    calls.push(['createMessage', channel, body]);
    if (failure) throw failure;
    return { id: 'm1', channel: { id: channel } };
  },
  editMessage: async (channel, id, body) => {
    calls.push(['editMessage', channel, id, body]);
    if (failure) throw failure;
    return { id };
  },
};

const run = async (command, channel, data) => command
  .getMessage({ discord, message: { channel, data } });
const embed = { title: '#1 Dark mode', color: 5793266 };

beforeEach(() => {
  calls = [];
  failure = undefined;
});

test('posting sends an embed to the channel and returns the new message', async () => {
  const result = await run(post, 'c1', { embed });

  assert.deepEqual(result, { id: 'm1', channel: 'c1' });
  assert.deepEqual(calls, [['createMessage', 'c1', {
    embeds: [embed],
    allowedMentions: { everyone: false, roles: false, users: false },
  }]]);
});

test('posting can send text, or text with an embed', async () => {
  await run(post, 'c1', { text: 'hello' });
  await run(post, 'c1', { text: 'hello', embed });

  assert.equal(calls[0][2].content, 'hello');
  assert.equal('embeds' in calls[0][2], false);
  assert.equal(calls[1][2].content, 'hello');
  assert.deepEqual(calls[1][2].embeds, [embed]);
});

test('posting never pings anyone, whatever the text says', async () => {
  await run(post, 'c1', { text: '@everyone <@123> <@&456>' });

  assert.deepEqual(calls[0][2].allowedMentions, { everyone: false, roles: false, users: false });
});

test('posting without a channel or without anything to post is refused before Discord is called', async () => {
  await assert.rejects(run(post, undefined, { text: 'x' }), /Channel not provided/);
  await assert.rejects(run(post, 'c1', undefined), /Message data not provided/);
  await assert.rejects(run(post, 'c1', {}), /text or embed/);
  await assert.rejects(run(post, 'c1', { text: '', embed: null }), /text or embed/);
  await assert.rejects(run(post, 'c1', { embed: 'not an object' }), /must be an object/);
  await assert.rejects(run(post, 'c1', { text: 'x'.repeat(MAX_TEXT + 1) }), /over 2000/);
  assert.equal(calls.length, 0);
});

test('a message of exactly the longest length is accepted', async () => {
  await run(post, 'c1', { text: 'x'.repeat(MAX_TEXT) });

  assert.equal(calls[0][2].content.length, MAX_TEXT);
});

test('editing replaces the message and returns its id', async () => {
  const result = await run(edit, 'c1', { id: 'm1', embed });

  assert.deepEqual(result, { id: 'm1' });
  assert.deepEqual(calls, [['editMessage', 'c1', 'm1', {
    content: '',
    embeds: [embed],
    allowedMentions: { everyone: false, roles: false, users: false },
  }]]);
});

test('editing to text only clears the embeds, and editing to an embed only clears the text', async () => {
  await run(edit, 'c1', { id: 'm1', text: 'now plain' });
  await run(edit, 'c1', { id: 'm1', embed });

  assert.deepEqual([calls[0][3].content, calls[0][3].embeds], ['now plain', []]);
  assert.deepEqual([calls[1][3].content, calls[1][3].embeds], ['', [embed]]);
});

test('editing needs a channel, a message id and something to show', async () => {
  await assert.rejects(run(edit, undefined, { id: 'm1', embed }), /Channel not provided/);
  await assert.rejects(run(edit, 'c1', { embed }), /Message ID not provided/);
  await assert.rejects(run(edit, 'c1', undefined), /Message ID not provided/);
  await assert.rejects(run(edit, 'c1', { id: 'm1' }), /text or embed/);
  assert.equal(calls.length, 0);
});

test('a refusal from Discord is returned as data so the plugin can decide what to do', async () => {
  failure = Object.assign(new Error('Unknown Message'), { code: 10008 });

  assert.deepEqual(await run(edit, 'c1', { id: 'gone', embed }), { error: 'Unknown message' });
  assert.deepEqual(await run(post, 'c1', { embed }), { error: 'Unknown message' });
});

test('Discord errors are turned into short messages', () => {
  assert.equal(discordError({ code: 10003 }), 'Unknown channel');
  assert.equal(discordError({ code: 10008 }), 'Unknown message');
  [50001, 50003, 50005, 50013].forEach(code => assert.equal(discordError({ code }), 'Access Denied'));
  assert.equal(discordError({ code: 50035 }), 'Invalid message');
  assert.equal(discordError({ message: 'Socket closed' }), 'Socket closed');
  assert.equal(discordError('plain'), 'plain');
});

test('content never carries an undefined value, which the database would refuse', () => {
  const bodies = [content({ text: 'x' }), content({ embed }), content({ id: 'm', text: 'x' }, { edit: true })];

  bodies.forEach((body) => {
    assert.equal(Object.values(body).some(value => value === undefined), false);
  });
});

test('both commands are found by the names plugins use', () => {
  assert.deepEqual(post.commands, ['post-message', 'postmessage']);
  assert.deepEqual(edit.commands, ['edit-message', 'editmessage']);
});
