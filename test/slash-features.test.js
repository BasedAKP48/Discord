const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  MAX_COMMANDS,
  commandArgs,
  commandText,
  findChatCommand,
  findMenuCommand,
  hashCommands,
  planSync,
  suggestions,
  toDiscordCommands,
} = require('../src/slash');

const arg = (overrides = {}) => ({
  name: 'target', description: 'Who or what', type: 'string', ...overrides,
});
const command = (name, extra = {}) => ({ name, description: `About ${name}`, ...extra });
const convert = (commands) => {
  const problems = [];
  const payload = toDiscordCommands(commands, { onProblem: text => problems.push(text) });
  return { payload, problems };
};
const choices = count => Array.from({ length: count }, (_, i) => ({ name: `Plan ${i}`, value: `plan-${i}` }));

test('every argument type has its Discord option type', () => {
  const types = {
    string: 3,
    integer: 4,
    boolean: 5,
    user: 6,
    channel: 7,
    role: 8,
    mentionable: 9,
    number: 10,
    attachment: 11,
  };

  Object.entries(types).forEach(([type, number]) => {
    const { payload } = convert([command('c', { args: [arg({ type })] })]);

    assert.equal(payload[0].options[0].type, number, type);
  });
});

test('limits are sent in the spelling Discord uses', () => {
  const { payload } = convert([command('c', {
    args: [
      arg({
        name: 'n', type: 'integer', minValue: 1, maxValue: 9,
      }),
      arg({ name: 'x', type: 'number', minValue: 0.5 }),
      arg({ name: 't', minLength: 2, maxLength: 8 }),
    ],
  })]);

  const [n, x, t] = payload[0].options;
  assert.deepEqual([n.min_value, n.max_value], [1, 9]);
  assert.deepEqual([x.min_value, 'max_value' in x], [0.5, false]);
  assert.deepEqual([t.min_length, t.max_length], [2, 8]);
});

test('an autocomplete argument is sent without its choices, since Discord refuses both', () => {
  const { payload } = convert([command('c', { args: [arg({ autocomplete: true, choices: choices(100) })] })]);

  assert.equal(payload[0].options[0].autocomplete, true);
  assert.equal('choices' in payload[0].options[0], false);
});

test('an argument without autocomplete still sends its choices, and none when there are none', () => {
  const { payload } = convert([command('c', {
    args: [arg({ name: 'a', choices: choices(2) }), arg({ name: 'b' })],
  })]);

  assert.deepEqual(payload[0].options[0].choices, choices(2));
  assert.equal('choices' in payload[0].options[1], false);
  assert.equal('autocomplete' in payload[0].options[1], false);
});

test('commands of a group become one command with a subcommand for each', () => {
  const { payload, problems } = convert([
    command('balance'),
    command('voucher-buy', {
      group: 'voucher',
      groupDescription: 'Buy vouchers',
      args: [arg({ name: 'plan', required: true }), arg({ name: 'note' })],
    }),
    command('voucher-mine', { group: 'voucher' }),
  ]);

  assert.deepEqual(payload.map(item => item.name), ['balance', 'voucher']);
  const group = payload[1];
  assert.equal(group.description, 'Buy vouchers');
  assert.equal(group.type, 1);
  assert.deepEqual(group.options.map(item => [item.type, item.name, item.description]), [
    [1, 'buy', 'About voucher-buy'],
    [1, 'mine', 'About voucher-mine'],
  ]);
  assert.deepEqual(group.options[0].options.map(option => [option.name, option.required]), [
    ['plan', true],
    ['note', false],
  ]);
  assert.deepEqual(group.options[1].options, []);
  assert.deepEqual(problems, []);
});

test('a subcommand has no required flag of its own, and a group without a description gets its name', () => {
  const { payload } = convert([command('voucher-mine', { group: 'voucher' })]);

  assert.equal('required' in payload[0].options[0], false);
  assert.equal(payload[0].description, 'voucher');
});

test('a group is sorted among the other commands by its name', () => {
  const { payload } = convert([command('zeta'), command('b-one', { group: 'b' }), command('alpha')]);

  assert.deepEqual(payload.map(item => item.name), ['alpha', 'b', 'zeta']);
});

test('the settings of a group are the ones its subcommands agree on', () => {
  const settings = { dmPermission: false, defaultMemberPermissions: '32' };
  const { payload, problems } = convert([
    command('a-one', { group: 'a', discord: settings }),
    command('a-two', { group: 'a', discord: settings }),
  ]);

  assert.equal(payload[0].dmPermission, false);
  assert.equal(payload[0].defaultMemberPermissions, '32');
  assert.deepEqual(problems, []);
});

test('when subcommands disagree the group is as strict as the strictest, and it is reported', () => {
  const { payload, problems } = convert([
    command('a-one', { group: 'a', discord: { dmPermission: true, defaultMemberPermissions: '32', nsfw: false } }),
    command('a-two', { group: 'a', discord: { dmPermission: false, defaultMemberPermissions: '8', nsfw: true } }),
  ]);

  assert.equal(payload[0].dmPermission, false);
  assert.equal(payload[0].defaultMemberPermissions, '40');
  assert.equal(payload[0].nsfw, true);
  assert.deepEqual(problems, [
    'the subcommands of a do not agree about dmPermission, which is off if any of them turns it off',
    'the subcommands of a do not agree about nsfw, which is on if any of them turns it on',
    'the subcommands of a do not agree about defaultMemberPermissions, which asks for all of them',
  ]);
});

test('a subcommand that sets nothing while another restricts the group is reported too', () => {
  const { payload, problems } = convert([
    command('a-one', { group: 'a', discord: { defaultMemberPermissions: '32' } }),
    command('a-two', { group: 'a' }),
  ]);

  assert.equal(payload[0].defaultMemberPermissions, '32');
  assert.equal(problems.length, 1);
});

test('a permission that is not a number is reported and left off', () => {
  const { payload, problems } = convert([
    command('a-one', { group: 'a', discord: { defaultMemberPermissions: 'lots' } }),
  ]);

  assert.equal('defaultMemberPermissions' in payload[0], false);
  assert.deepEqual(problems, ['the subcommands of a have a defaultMemberPermissions that is not a number']);
});

test('commands that cannot be in a group are reported, and the rest still register', () => {
  const { payload, problems } = convert([
    command('voucher'),
    command('voucher-buy', { group: 'voucher' }),
    command('x-one', { group: 'x', cid: 'p1' }),
    command('x-two', { group: 'x', subcommand: 'one', cid: 'p2' }),
  ]);

  assert.deepEqual(payload.map(item => item.name), ['voucher', 'x']);
  assert.deepEqual(problems, [
    'command voucher-buy is not in the group voucher: a command has the name of the group',
    'command x-two is not in the group x: the subcommand is already taken',
  ]);
});

test('a command with a context also has a menu entry, with a name and nothing else', () => {
  const { payload } = convert([
    command('balance'),
    command('voucher-mine', {
      args: [arg({ name: 'target', type: 'user' })],
      context: { type: 'user', arg: 'target' },
      discord: { dmPermission: false },
    }),
    command('remind-me', {
      args: [arg({ name: 'text' })],
      context: { type: 'message', arg: 'text', name: 'Remind me of this' },
    }),
  ]);

  assert.deepEqual(payload.map(item => [item.type, item.name]), [
    [1, 'balance'],
    [1, 'remind-me'],
    [1, 'voucher-mine'],
    [2, 'Voucher mine'],
    [3, 'Remind me of this'],
  ]);
  assert.deepEqual(payload[3], { name: 'Voucher mine', type: 2, dmPermission: false });
  assert.deepEqual(payload[4], { name: 'Remind me of this', type: 3 });
});

test('a subcommand keeps its own menu entry, apart from its group', () => {
  const { payload } = convert([command('voucher-mine', {
    group: 'voucher',
    args: [arg({ name: 'target', type: 'user' })],
    context: { type: 'user', arg: 'target' },
  })]);

  assert.deepEqual(payload.map(item => [item.type, item.name]), [[1, 'voucher'], [2, 'Voucher mine']]);
});

test('menus that cannot be shown are reported', () => {
  const same = name => command(name, {
    args: [arg({ name: 'target', type: 'user' })],
    context: { type: 'user', arg: 'target', name: 'Show' },
  });

  const { payload, problems } = convert([same('a'), same('b')]);

  assert.equal(payload.filter(item => item.type === 2).length, 1);
  assert.deepEqual(problems, ['command b is not in the user menu: the menu name is already taken']);
});

test('the limit on commands applies to the chat commands, and the menus come after them', () => {
  const many = Array.from({ length: MAX_COMMANDS + 5 }, (_, i) => command(`c${String(i).padStart(3, '0')}`));
  const withMenu = command('menu', { args: [arg({ name: 't', type: 'user' })], context: { type: 'user', arg: 't' } });

  const { payload } = convert([...many, withMenu]);

  assert.equal(payload.filter(item => item.type === 1).length, MAX_COMMANDS);
  assert.equal(payload[payload.length - 1].type, 2);
});

test('adding a group, a limit or a menu changes what is registered', () => {
  const plain = [command('voucher-buy')];
  const hash = list => hashCommands(convert(list).payload);

  assert.notEqual(hash(plain), hash([command('voucher-buy', { group: 'voucher' })]));
  assert.notEqual(hash([command('c', { args: [arg()] })]), hash([command('c', { args: [arg({ maxLength: 5 })] })]));
  assert.notEqual(hash(plain), hash([command('voucher-buy', {
    args: [arg({ type: 'user' })], context: { type: 'user', arg: 'target' },
  })]));
});

test('each place gets the groups of its own commands, and problems are reported', () => {
  const problems = [];
  const list = [
    command('a-one', { group: 'a', where: 'everywhere' }),
    command('a-two', { group: 'a', where: 'g1' }),
  ];

  const plan = planSync(list, {
    guildsOf: item => (item.where === 'g1' ? ['g1'] : []),
    onProblem: text => problems.push(text),
  });

  assert.deepEqual(plan.global[0].options.map(item => item.name), ['one']);
  assert.deepEqual(plan.guilds.get('g1')[0].options.map(item => item.name), ['two']);
  assert.deepEqual(problems, []);
});

test('with a single guild every command is registered there, groups and menus included', () => {
  const plan = planSync([command('a-one', { group: 'a' })], {
    commandGuild: 'g9',
    guildsOf: () => [],
  });

  assert.equal(plan.global, undefined);
  assert.equal(plan.guilds.get('g9')[0].name, 'a');
});

const lookup = [
  command('balance', { args: [arg({ name: 'currency' })] }),
  command('voucher-buy', {
    group: 'voucher',
    args: [arg({ name: 'plan', autocomplete: true, choices: choices(40) }), arg({ name: 'note' })],
  }),
  command('voucher-mine', {
    args: [arg({ name: 'target', type: 'user' })],
    context: { type: 'user', arg: 'target' },
  }),
  command('remind-me', {
    args: [arg({ name: 'text' })],
    context: { type: 'message', arg: 'text', name: 'Remind me' },
  }),
];

test('a typed chat command is found by its name, with its options', () => {
  const found = findChatCommand(lookup, { name: 'balance', options: [{ name: 'currency', value: 'GEM' }] });

  assert.equal(found.command.name, 'balance');
  assert.deepEqual(found.options, [{ name: 'currency', value: 'GEM' }]);
});

test('a subcommand is found by its group and its own name, with the options inside it', () => {
  const found = findChatCommand(lookup, {
    name: 'voucher',
    options: [{ type: 1, name: 'buy', options: [{ name: 'plan', value: 'plan-1' }] }],
  });

  assert.equal(found.command.name, 'voucher-buy');
  assert.deepEqual(found.options, [{ name: 'plan', value: 'plan-1' }]);
});

test('a subcommand without options has none, and an unknown one is not found', () => {
  assert.deepEqual(findChatCommand(lookup, { name: 'voucher', options: [{ type: 1, name: 'buy' }] }).options, []);
  assert.equal(findChatCommand(lookup, { name: 'voucher', options: [{ type: 1, name: 'refund' }] }), null);
  assert.equal(findChatCommand(lookup, { name: 'nothing', options: [] }), null);
});

test('a name that Discord remembers from before a command joined a group still finds the command', () => {
  assert.equal(findChatCommand(lookup, { name: 'voucher-buy', options: [] }).command.name, 'voucher-buy');
});

test('a menu command is found by its type and its menu name', () => {
  const user = findMenuCommand(lookup, { type: 2, name: 'Voucher mine' });
  const message = findMenuCommand(lookup, { type: 3, name: 'Remind me' });

  assert.deepEqual([user.command.name, user.arg], ['voucher-mine', 'target']);
  assert.deepEqual([message.command.name, message.arg], ['remind-me', 'text']);
  assert.equal(findMenuCommand(lookup, { type: 3, name: 'Voucher mine' }), null);
  assert.equal(findMenuCommand(lookup, { type: 2, name: 'Nothing' }), null);
});

const typing = (value, extra = {}) => ({
  name: 'voucher',
  options: [{
    type: 1,
    name: 'buy',
    options: [{
      name: 'plan', type: 3, value, focused: true, ...extra,
    }],
  }],
});

test('suggestions are the choices that match what was typed, at most 25', () => {
  assert.deepEqual(suggestions(lookup, typing('plan 3')).map(item => item.value), ['plan-3', 'plan-30', 'plan-31', 'plan-32', 'plan-33', 'plan-34', 'plan-35', 'plan-36', 'plan-37', 'plan-38', 'plan-39']);
  assert.equal(suggestions(lookup, typing('plan')).length, 25);
});

test('with nothing typed the first choices are suggested', () => {
  assert.deepEqual(suggestions(lookup, typing('')).slice(0, 2), choices(2));
  assert.equal(suggestions(lookup, typing(undefined)).length, 25);
});

test('suggestions are only choice and value, whatever else the choices carry', () => {
  const list = [command('c', { args: [arg({ name: 'p', autocomplete: true, choices: [{ name: 'A', value: 'a', extra: 1 }] })] })];

  const result = suggestions(list, { name: 'c', options: [{ name: 'p', value: 'a', focused: true }] });

  assert.deepEqual(result, [{ name: 'A', value: 'a' }]);
});

test('numbers typed so far are matched as text', () => {
  const list = [command('c', {
    args: [arg({
      name: 'n', type: 'integer', autocomplete: true, choices: [{ name: 'Small', value: 1 }, { name: 'Large', value: 30 }],
    })],
  })];

  const result = suggestions(list, { name: 'c', options: [{ name: 'n', value: 3, focused: true }] });

  assert.deepEqual(result, [{ name: 'Large', value: 30 }]);
});

test('nothing is suggested for an argument that is not an autocomplete list, or when nothing is focused', () => {
  assert.deepEqual(suggestions(lookup, { name: 'balance', options: [{ name: 'currency', value: 'g', focused: true }] }), []);
  assert.deepEqual(suggestions(lookup, { name: 'voucher', options: [{ type: 1, name: 'buy', options: [{ name: 'plan', value: 'p' }] }] }), []);
  assert.deepEqual(suggestions(lookup, { name: 'nothing', options: [{ name: 'x', value: 'p', focused: true }] }), []);
  assert.deepEqual(suggestions(lookup, typing('p', { name: 'note' })), []);
});

test('arguments are the values of the options, and attachments are described', () => {
  const list = command('c', {
    args: [arg({ name: 'who', type: 'user' }), arg({ name: 'file', type: 'attachment' }), arg({ name: 'n', type: 'integer' })],
  });
  const resolved = {
    attachments: {
      a1: {
        id: 'a1', url: 'https://cdn.test/a.png', filename: 'a.png', content_type: 'image/png', size: 12, width: 5,
      },
    },
  };

  const args = commandArgs(list, [
    { name: 'who', value: '123' },
    { name: 'file', value: 'a1' },
    { name: 'n', value: 7 },
  ], resolved);

  assert.deepEqual(args, {
    who: '123',
    file: {
      id: 'a1', url: 'https://cdn.test/a.png', filename: 'a.png', contentType: 'image/png', size: 12,
    },
    n: 7,
  });
});

test('an attachment that is not described is passed on as its id, and no property is undefined', () => {
  const list = command('c', { args: [arg({ name: 'file', type: 'attachment' })] });

  assert.deepEqual(commandArgs(list, [{ name: 'file', value: 'a1' }], {}), { file: 'a1' });
  const sparse = commandArgs(list, [{ name: 'file', value: 'a1' }], { attachments: { a1: { id: 'a1', url: 'u' } } });
  assert.deepEqual(sparse, { file: { id: 'a1', url: 'u' } });
  assert.equal(Object.values(sparse.file).some(value => value === undefined), false);
});

test('the typed form of a command shows an attachment by its address', () => {
  const list = command('c', { args: [arg({ name: 'who', type: 'user' }), arg({ name: 'file', type: 'attachment' })] });
  const resolved = { attachments: { a1: { url: 'https://cdn.test/a.png' } } };

  assert.equal(
    commandText('.', list, [{ name: 'who', value: '123' }, { name: 'file', value: 'a1' }], resolved),
    '.c 123 https://cdn.test/a.png',
  );
  assert.equal(commandText('.', list, [{ name: 'file', value: 'a1' }]), '.c a1');
});
