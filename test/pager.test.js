const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createPageHandler, EPHEMERAL } = require('../src/interactions');
const { attachPages, createPager } = require('../src/pager');

const pages = [{ title: 'One' }, { title: 'Two', footer: { text: 'Open' } }, { title: 'Three' }];

const build = (options = {}) => {
  let clock = 1000;
  let count = 0;
  const pager = createPager({
    ttl: 60000,
    now: () => clock,
    makeKey: () => {
      count += 1;
      return `k${count}`;
    },
    ...options,
  });
  return { pager, advance: (ms) => { clock += ms; } };
};

test('the first page comes with buttons, a page count and a note that it is a snapshot', () => {
  const { pager } = build();

  const added = pager.add(pages);

  assert.equal(added.key, 'k1');
  assert.equal(added.embeds[0].title, 'One');
  assert.equal(added.embeds[0].footer.text, 'Page 1 of 3 · a snapshot, it does not update');
  assert.equal(added.embeds[0].timestamp, new Date(1000).toISOString());
  const [previous, label, next] = added.components[0].components;
  assert.deepEqual(
    [previous.disabled, label.label, label.disabled, next.disabled],
    [true, '1 / 3', true, false],
  );
  assert.equal(next.custom_id, 'page:k1:1');
});

test('a footer the plugin set is kept in front of the page note', () => {
  const { pager } = build();
  const { key } = pager.add(pages);

  assert.equal(pager.open(key, 1).embeds[0].footer.text, 'Open · Page 2 of 3 · a snapshot, it does not update');
});

test('the last page cannot go further, and the middle can go both ways', () => {
  const { pager } = build();
  const { key } = pager.add(pages);

  const [prevLast, , nextLast] = pager.open(key, 2).components[0].components;
  const [prevMid, , nextMid] = pager.open(key, 1).components[0].components;

  assert.deepEqual([prevLast.disabled, nextLast.disabled], [false, true]);
  assert.deepEqual([prevMid.custom_id, nextMid.custom_id], ['page:k1:0', 'page:k1:2']);
  assert.deepEqual([prevMid.disabled, nextMid.disabled], [false, false]);
});

test('a page number outside the list is brought back into it', () => {
  const { pager } = build();
  const { key } = pager.add(pages);

  assert.equal(pager.open(key, 99).embeds[0].title, 'Three');
  assert.equal(pager.open(key, -4).embeds[0].title, 'One');
});

test('the pages are gone after the time limit', () => {
  const { pager, advance } = build();
  const { key } = pager.add(pages);

  advance(59000);
  assert.notEqual(pager.open(key, 0), null);
  advance(2000);
  assert.equal(pager.open(key, 0), null);
});

test('only the newest lists are kept when many are made', () => {
  const { pager } = build();
  const keys = Array.from({ length: 205 }, () => pager.add(pages).key);

  assert.equal(pager.open(keys[0], 0), null);
  assert.notEqual(pager.open(keys[keys.length - 1], 0), null);
});

test('things that are not pages are left out, and nothing to show gives nothing', () => {
  const { pager } = build();

  assert.equal(pager.add([]), null);
  assert.equal(pager.add([null, 'text', ['x']]), null);
  assert.equal(pager.open(pager.add([null, { title: 'Real' }]).key, 0).embeds[0].title, 'Real');
});

test('button ids are read back, and anything else is not ours', () => {
  const { pager } = build();

  assert.deepEqual(pager.parse('page:k1:2'), { key: 'k1', index: 2 });
  ['page:k1', 'page:k1:-1', 'page:k1:x', 'other:k1:2', '', undefined, 'page::2'].forEach((id) => {
    assert.equal(pager.parse(id), null, String(id));
  });
});

const createClick = (customId, user = { id: 'u1' }, overrides = {}) => {
  const calls = [];
  return {
    calls,
    type: 3,
    data: { custom_id: customId },
    member: { user },
    editParent: async content => calls.push(['editParent', content]),
    createFollowup: async content => calls.push(['createFollowup', content]),
    createMessage: async content => calls.push(['createMessage', content]),
    ...overrides,
  };
};

test('the person who asked turns the page by editing the message', async () => {
  const { pager } = build();
  const { key } = pager.add(pages);
  const click = createClick(`page:${key}:1`);

  const handled = await createPageHandler({ pager })(click);

  assert.equal(handled, true);
  assert.equal(click.calls.length, 1);
  assert.equal(click.calls[0][0], 'editParent');
  assert.equal(click.calls[0][1].embeds[0].title, 'Two');
  assert.equal(click.calls[0][1].components[0].components[1].label, '2 / 3');
});

test('anyone in the channel can turn the pages, not only the person who asked', async () => {
  const { pager } = build();
  const { key } = pager.add(pages);

  const first = createClick(`page:${key}:1`, { id: 'u2' });
  const second = createClick(`page:${key}:2`, { id: 'u3' });
  await createPageHandler({ pager })(first);
  await createPageHandler({ pager })(second);

  assert.equal(first.calls[0][1].embeds[0].title, 'Two');
  assert.equal(second.calls[0][1].embeds[0].title, 'Three');
});

test('an expired list loses its buttons and the clicker is told', async () => {
  const { pager, advance } = build();
  const { key } = pager.add(pages);
  advance(120000);
  const click = createClick(`page:${key}:1`);

  await createPageHandler({ pager })(click);

  assert.deepEqual(click.calls, [
    ['editParent', { components: [] }],
    ['createFollowup', { content: 'That list has expired. Run the command again for a fresh one.', flags: EPHEMERAL }],
  ]);
});

test('a click in a direct message works with the user instead of a member', async () => {
  const { pager } = build();
  const { key } = pager.add(pages);
  const click = createClick(`page:${key}:2`, undefined, { member: undefined, user: { id: 'u1' } });

  await createPageHandler({ pager })(click);

  assert.equal(click.calls[0][1].embeds[0].title, 'Three');
});

test('other interactions and other buttons are not handled', async () => {
  const { pager } = build();
  const handle = createPageHandler({ pager });

  assert.equal(await handle(createClick('something:else')), false);
  assert.equal(await handle(createClick('page:k1:1', undefined, { type: 2 })), false);
  assert.equal(await handle(createClick('page:k1:1', undefined, { data: undefined })), false);
});

test('several pages replace the text with the first page and its buttons', () => {
  const { pager } = build();

  const content = attachPages(pager, { content: 'fallback' }, pages);

  assert.equal('content' in JSON.parse(JSON.stringify(content)), false);
  assert.equal(content.embeds[0].title, 'One');
  assert.equal(content.components[0].components.length, 3);
});

test('one page is a plain embed without buttons or a note', () => {
  const { pager } = build();

  const content = attachPages(pager, { content: 'fallback' }, [pages[0]]);

  assert.deepEqual(content.embeds, [pages[0]]);
  assert.equal('components' in content, false);
});

test('no pages leave the content as it was', () => {
  const { pager } = build();
  const original = { content: 'fallback' };

  [undefined, [], 'x', [null]].forEach((none) => {
    assert.deepEqual(attachPages(pager, original, none), original);
  });
});
