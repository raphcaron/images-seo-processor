export class Queue {
  #queue = [];
  #processing = false;

  add(fn) {
    return new Promise((resolve, reject) => {
      this.#queue.push({ fn, resolve, reject });
      this.#processNext();
    });
  }

  async #processNext() {
    if (this.#processing || this.#queue.length === 0) return;

    this.#processing = true;
    const { fn, resolve, reject } = this.#queue.shift();

    try {
      const result = await fn();
      resolve(result);
    } catch (err) {
      reject(err);
    } finally {
      this.#processing = false;
      this.#processNext();
    }
  }

  get size() {
    return this.#queue.length;
  }

  get isProcessing() {
    return this.#processing;
  }
}
