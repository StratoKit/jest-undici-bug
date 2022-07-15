const { fetch } = require("undici");
const { Readable } = require("stream");
const delay = require("delay");

class TimeoutStream extends Readable {
	constructor(size, speed, requestTimeout = 0, timeouts) {
		super();
		this.size = size;
		this.requestTimeout = requestTimeout;
		this.timeouts = [...timeouts].sort(
			(a, b) => (a.after || 0) - (b.after || 0)
		);
		this._transferred = 0;
		this.speed = speed;
	}
	async _read(chunkSize) {
		if (this.requestTimeout) {
			await delay(this.requestTimeout);
			this.requestTimeout = 0;
		}
		const toTransfer = Math.min(this.size - this._transferred, chunkSize);
		if (toTransfer === 0) {
			this.push(null);
			return;
		}
		if (this.speed) await delay((toTransfer / this.speed) * 1000);
		if (this.timeouts.length && this.timeouts[0].after <= this._transferred) {
			await delay(this.timeouts[0].time);
			this.timeouts.splice(0, 1);
		}
		if (this.aborted) {
			this.push(null);
			return;
		}
		this.push(Buffer.alloc(toTransfer));
		this._transferred += toTransfer;

		if (this.size <= this._transferred) {
			this.push(null);
		}
	}
	_destroy() {
		this.aborted = true;
		this.push(null);
	}
}

const fastify = require("fastify")({
	logger: true,
});
fastify.route({
	method: "GET",
	url: "/",
	handler: async () => {
		return "hello";
	},
});
fastify.route({
	method: "POST",
	url: "/:id",
	handler: async (req) => {
		const {
			requestTimeout,
			size = 1024 * 1024,
			speed,
			bodyTimeouts = [],
		} = req.body;

		return new TimeoutStream(size, speed, requestTimeout, bodyTimeouts);
	},
});

const start = async () => {
	await fastify.listen(0);
	const port = fastify.server.address().port;

	const ac = new AbortController();
	ac.signal.addEventListener("abort", () => {
		console.log("aborted");
	});
	setTimeout(() => {
		ac.abort();
	}, 3000);

	try {
		const res = await fetch(`http://localhost:${port}/yo`, {
			method: "POST",
			body: JSON.stringify({ bodyTimeouts: [{ after: 500, time: 5000 }] }),
			headers: { "content-type": "application/json" },
			signal: ac.signal,
		});
		console.log("request completed, fetching body...");
		await res.blob();
		console.log("fetching body completed");
	} catch (e) {
		console.error(e);
	}

	console.log("shutting down Fastify...");
	await fastify.close();
};

start();
