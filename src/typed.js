function readTyped(message, {
  commands, parse, usage, prefix, isAllowed = () => true,
}) {
  if (message.type !== 'text') return null;

  const online = Array.from(commands.values()).filter(command => command.online);
  const parsed = parse(message.text, online, { prefix, direct: message.data.isPM === true });
  if (!parsed || !isAllowed(parsed.command, message)) return null;

  if (parsed.problem) {
    return { reply: `${parsed.problem}. Usage: ${usage(parsed.command, prefix)}` };
  }
  return {
    message: {
      ...message,
      type: 'command',
      data: {
        ...message.data,
        command: parsed.command.name,
        args: parsed.args,
      },
    },
  };
}

module.exports = { readTyped };
