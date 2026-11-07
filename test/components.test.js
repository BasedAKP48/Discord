const assert = require('node:assert/strict');
const { test } = require('node:test');

const { toDiscordComponents, withComponents } = require('../src/components');

const confirm = { id: 'confirm', label: 'Confirm', style: 'success' };
const cancel = { id: 'cancel', label: 'Cancel' };
const redeem = { url: 'https://example.test/redeem', label: 'Redeem' };

test('a flat list of buttons becomes one action row, with the custom id of the plugin', () => {
  const rows = toDiscordComponents('vouchers', [confirm, cancel]);

  assert.deepEqual(rows, [{
    type: 1,
    components: [
      {
        type: 2, label: 'Confirm', disabled: false, style: 3, custom_id: 'btn:vouchers:confirm',
      },
      {
        type: 2, label: 'Cancel', disabled: false, style: 2, custom_id: 'btn:vouchers:cancel',
      },
    ],
  }]);
});

test('every style has its Discord number, and secondary is the default', () => {
  const styles = ['primary', 'secondary', 'success', 'danger'].map((style, i) => ({ id: `b${i}`, label: 'x', style }));

  const [row] = toDiscordComponents('p', styles);

  assert.deepEqual(row.components.map(button => button.style), [1, 2, 3, 4]);
  assert.equal(toDiscordComponents('p', [cancel])[0].components[0].style, 2);
});

test('a link button has the link style and an address, and no custom id', () => {
  const [row] = toDiscordComponents('p', [redeem]);

  assert.deepEqual(row.components, [{
    type: 2, label: 'Redeem', disabled: false, style: 5, url: 'https://example.test/redeem',
  }]);
});

test('a disabled button is sent disabled, and rows stay as the plugin wrote them', () => {
  const rows = toDiscordComponents('p', [[{ ...confirm, disabled: true }], [cancel, redeem]]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].components[0].disabled, true);
  assert.equal(rows[1].components.length, 2);
});

test('buttons that are not valid, or whose id is too long for the plugin, are refused', () => {
  assert.throws(() => toDiscordComponents('p', [{ label: 'No id' }]), /Invalid components/);
  assert.throws(() => toDiscordComponents('x'.repeat(46), [{ id: 'y'.repeat(50), label: 'x' }]), /too long/);
  assert.throws(() => toDiscordComponents('a:b', [cancel]), /cannot contain/);
});

test('components are added to the content, after the buttons that are already there', () => {
  const pager = [{ type: 1, components: [{ type: 2, custom_id: 'page:k:1' }] }];

  const content = withComponents({ content: 'hi', components: pager }, 'p', [confirm]);

  assert.equal(content.content, 'hi');
  assert.deepEqual(content.components[0], pager[0]);
  assert.equal(content.components[1].components[0].custom_id, 'btn:p:confirm');
});

test('there are never more than five rows, and the plugin\'s rows are the ones cut', () => {
  const pager = [{ type: 1, components: [] }, { type: 1, components: [] }];
  const rows = ['a', 'b', 'c', 'd', 'e'].map(id => [{ id, label: id }]);

  const content = withComponents({ components: pager }, 'p', rows);

  assert.equal(content.components.length, 5);
  assert.deepEqual(content.components.slice(0, 2), pager);
});

test('without components the content is untouched, and an empty list asks for the buttons to go', () => {
  const content = { content: 'hi' };

  assert.equal(withComponents(content, 'p', undefined), content);
  assert.equal(withComponents(content, 'p', null), content);
  assert.deepEqual(withComponents(content, 'p', []), { content: 'hi', components: [] });
});

test('bad components are reported and the message is still sent without them', () => {
  const errors = [];
  const content = { content: 'hi' };

  const result = withComponents(content, 'p', [{ label: 'No id' }], error => errors.push(error.message));

  assert.equal(result, content);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /needs exactly one of id or url/);
});

test('the content that was passed in is not changed', () => {
  const content = { content: 'hi', components: [] };

  withComponents(content, 'p', [confirm]);

  assert.deepEqual(content, { content: 'hi', components: [] });
});
