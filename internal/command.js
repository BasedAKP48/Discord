class Command {
  constructor(options) {
    this.alias = Array.isArray(options.alias) ? options.alias : [options.alias];
  }

  get name() {
    return this.constructor.name;
  }

  /**
   * @type {String[]}
   */
  get commands() {
    return this.alias;
  }

  /**
   * Called by discord
   * @public
   */
  getMessage(options) {
    return Promise.resolve(this.runCommand(options)).then((data) => {
      if (emptyObject(data)) throw new Error('Data not available');
      return data;
    });
  }

  /**
   * @private
   */
  runCommand(options) {
    throw new Error(`${this.name || 'command'}#runCommand must be overridden`);
  }
}

function emptyObject(object) {
  return object === undefined || object === null ||
    (object.constructor === Object && !Object.keys(object).length);
}

module.exports = Command;
