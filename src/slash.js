const crypto = require('crypto');
const { Constants } = require('eris');
const utils = require('@basedakp48/plugin-utils');

const { ApplicationCommandOptionTypes: OPTION, ApplicationCommandTypes: COMMAND } = Constants;

const MAX_COMMANDS = 100;
const MAX_SUGGESTIONS = 25;
const OPTION_TYPES = {
  string: OPTION.STRING,
  integer: OPTION.INTEGER,
  number: OPTION.NUMBER,
  boolean: OPTION.BOOLEAN,
  user: OPTION.USER,
  channel: OPTION.CHANNEL,
  role: OPTION.ROLE,
  mentionable: OPTION.MENTIONABLE,
  attachment: OPTION.ATTACHMENT,
};
const LIMITS = {
  minValue: 'min_value',
  maxValue: 'max_value',
  minLength: 'min_length',
  maxLength: 'max_length',
};
const EXTRAS = ['dmPermission', 'defaultMemberPermissions', 'nsfw'];

function toDiscordOption(arg) {
  const option = {
    name: arg.name,
    description: arg.description,
    type: OPTION_TYPES[arg.type],
    required: arg.required === true,
  };
  if (arg.autocomplete === true) {
    option.autocomplete = true;
  } else if (Array.isArray(arg.choices) && arg.choices.length) {
    option.choices = arg.choices.map(({ name, value }) => ({ name, value }));
  }
  Object.entries(LIMITS).forEach(([key, discordKey]) => {
    if (arg[key] !== undefined) option[discordKey] = arg[key];
  });
  return option;
}

function settingsOf(command) {
  const extras = command.discord || {};
  return EXTRAS.reduce((settings, key) => (
    extras[key] === undefined ? settings : { ...settings, [key]: extras[key] }
  ), {});
}

function toDiscordCommand(command) {
  return {
    name: command.name,
    description: command.description,
    type: COMMAND.CHAT_INPUT,
    options: (command.args || []).map(toDiscordOption),
    ...settingsOf(command),
  };
}

function disagreement(values) {
  return values.some(value => value !== undefined) && new Set(values).size > 1;
}

function mergeSettings(commands, name, onProblem) {
  const all = commands.map(settingsOf);
  const merged = {};
  const problems = [];

  const dm = all.map(settings => settings.dmPermission);
  if (dm.some(value => value !== undefined)) {
    merged.dmPermission = dm.every(value => value !== false);
    if (disagreement(dm)) problems.push('dmPermission, which is off if any of them turns it off');
  }

  const nsfw = all.map(settings => settings.nsfw);
  if (nsfw.some(value => value !== undefined)) {
    merged.nsfw = nsfw.some(value => value === true);
    if (disagreement(nsfw)) problems.push('nsfw, which is on if any of them turns it on');
  }

  const permissions = all.map(settings => settings.defaultMemberPermissions);
  if (permissions.some(value => value !== undefined)) {
    try {
      merged.defaultMemberPermissions = permissions
        .filter(value => value !== undefined && value !== null)
        .reduce((bits, value) => bits | BigInt(value), BigInt(0))
        .toString();
      if (disagreement(permissions)) problems.push('defaultMemberPermissions, which asks for all of them');
    } catch (error) {
      onProblem(`the subcommands of ${name} have a defaultMemberPermissions that is not a number`);
    }
  }

  problems.forEach(problem => onProblem(`the subcommands of ${name} do not agree about ${problem}`));
  return merged;
}

function toDiscordGroup(group, onProblem) {
  return {
    name: group.name,
    description: group.description,
    type: COMMAND.CHAT_INPUT,
    options: group.subcommands.map(({ name, command }) => ({
      type: OPTION.SUB_COMMAND,
      name,
      description: command.description,
      options: (command.args || []).map(toDiscordOption),
    })),
    ...mergeSettings(group.subcommands.map(({ command }) => command), group.name, onProblem),
  };
}

const byName = (a, b) => a.name.localeCompare(b.name);

function toDiscordCommands(commands, { onProblem = () => {} } = {}) {
  const { standalone, groups, conflicts } = utils.groupCommands(commands);
  const menus = utils.contextMenus(commands);

  conflicts.forEach(({ name, group, reason }) => {
    onProblem(`command ${name} is not in the group ${group}: ${reason}`);
  });
  menus.conflicts.forEach(({ name, type, reason }) => {
    onProblem(`command ${name} is not in the ${type} menu: ${reason}`);
  });

  const chat = [
    ...standalone.map(toDiscordCommand),
    ...groups.map(group => toDiscordGroup(group, onProblem)),
  ].sort(byName).slice(0, MAX_COMMANDS);
  const menu = (type, list) => list
    .map(({ name, command }) => ({ name, type, ...settingsOf(command) }))
    .sort(byName);

  return [
    ...chat,
    ...menu(COMMAND.USER, menus.user),
    ...menu(COMMAND.MESSAGE, menus.message),
  ];
}

function hashCommands(payload) {
  return crypto.createHash('sha1').update(JSON.stringify(payload)).digest('hex');
}

const GLOBAL = 'global';

function planSync(commands, { commandGuild, guildsOf, onProblem }) {
  const convert = list => toDiscordCommands(list, { onProblem });
  if (commandGuild) {
    return { global: undefined, guilds: new Map([[commandGuild, convert(commands)]]) };
  }

  const everywhere = [];
  const scoped = new Map();
  commands.forEach((command) => {
    const ids = guildsOf(command);
    if (!ids.length) {
      everywhere.push(command);
      return;
    }
    ids.forEach(id => scoped.set(id, [...(scoped.get(id) || []), command]));
  });

  return {
    global: convert(everywhere),
    guilds: new Map([...scoped].map(([id, list]) => [id, convert(list)])),
  };
}

function reconcile(plan, synced) {
  const updates = [];
  const consider = (target, payload) => {
    const hash = hashCommands(payload);
    if (synced.get(target) !== hash) updates.push({ target, payload, hash });
  };

  if (plan.global !== undefined) consider(GLOBAL, plan.global);
  plan.guilds.forEach((payload, id) => consider(id, payload));

  const clears = [...synced.keys()].filter(target => target !== GLOBAL && !plan.guilds.has(target));
  return { updates, clears };
}

const isText = arg => arg.type === 'string';

function wordFor(arg, value, resolved) {
  if (arg.type !== 'attachment') return String(value);
  const found = resolved && resolved.attachments && resolved.attachments[value];
  return found && found.url ? found.url : String(value);
}

function commandText(prefix, command, options = [], resolved) {
  const values = new Map((options || []).map(option => [option.name, option.value]));
  const args = command.args || [];
  const word = arg => wordFor(arg, values.get(arg.name), resolved);
  const words = [];
  for (let index = 0; index < args.length;) {
    if (!isText(args[index])) {
      if (values.has(args[index].name)) words.push(word(args[index]));
      index += 1;
    } else {
      let stop = index;
      while (stop < args.length && isText(args[stop])) stop += 1;
      const run = args.slice(index, stop);
      const last = run.map(arg => values.has(arg.name)).lastIndexOf(true);
      if (last !== -1) {
        words.push(run.slice(0, last + 1)
          .map(arg => (values.has(arg.name) ? word(arg) : ''))
          .join(' | ')
          .trim());
      }
      index = stop;
    }
  }
  return [`${prefix}${command.name}`, ...words].join(' ');
}

function attachmentOf(found) {
  return Object.entries({
    id: found.id,
    url: found.url,
    filename: found.filename,
    contentType: found.content_type,
    size: found.size,
  }).reduce((attachment, [key, value]) => (
    value === undefined ? attachment : { ...attachment, [key]: value }
  ), {});
}

function commandArgs(command, options, resolved) {
  const values = new Map((options || []).map(option => [option.name, option.value]));
  const read = (arg) => {
    const value = values.get(arg.name);
    if (arg.type !== 'attachment') return value;
    const found = resolved && resolved.attachments && resolved.attachments[value];
    return found ? attachmentOf(found) : value;
  };
  return (command.args || [])
    .filter(arg => values.has(arg.name))
    .reduce((args, arg) => ({ ...args, [arg.name]: read(arg) }), {});
}

function findChatCommand(commands, data) {
  const list = Array.from(commands);
  const first = Array.isArray(data.options) ? data.options[0] : undefined;
  if (first && first.type === OPTION.SUB_COMMAND) {
    const command = list.find(item => item.group === data.name
      && utils.subcommandName(item) === first.name);
    return command ? { command, options: first.options || [] } : null;
  }
  const command = list.find(item => item.name === data.name);
  return command ? { command, options: data.options || [] } : null;
}

function findMenuCommand(commands, data) {
  const menus = utils.contextMenus(commands);
  const list = data.type === COMMAND.USER ? menus.user : menus.message;
  return list.find(item => item.name === data.name) || null;
}

function focusedOption(options) {
  return (options || []).reduce((found, option) => {
    if (found) return found;
    if (option.focused === true) return option;
    return Array.isArray(option.options) ? focusedOption(option.options) : undefined;
  }, undefined);
}

function suggestions(commands, data) {
  const found = findChatCommand(commands, data);
  const focused = focusedOption(data.options);
  if (!found || !focused) return [];

  const arg = (found.command.args || []).find(item => item.name === focused.name);
  if (!arg || arg.autocomplete !== true || !Array.isArray(arg.choices)) return [];
  const typed = focused.value === undefined || focused.value === null ? '' : String(focused.value);
  return utils.filterChoices(arg.choices, typed, MAX_SUGGESTIONS)
    .map(({ name, value }) => ({ name, value }));
}

module.exports = {
  GLOBAL,
  MAX_COMMANDS,
  MAX_SUGGESTIONS,
  commandArgs,
  commandText,
  findChatCommand,
  findMenuCommand,
  hashCommands,
  planSync,
  reconcile,
  suggestions,
  toDiscordCommands,
};
