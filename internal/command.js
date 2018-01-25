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
    return new Promise((res, rej) => {
      const data = this.runCommand(options);
      if (!data || emptyObject(data)) throw new Error('Data not available');
      if (data instanceof Promise) {
        data.catch(rej)
          .then((result) => {
            if (emptyObject(result)) {
              rej(new Error('Data not available'));
            } else {
              res(result);
            }
          });
      } else {
        res(data);
      }
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
  return !Object.keys(object).length && object.constructor === Object;
}

module.exports = Command;
