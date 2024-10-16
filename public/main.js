/* global UIkit, Vue, SESSION_ID */
(() => {
  const notification = (config) =>
    UIkit.notification({
      pos: "top-right",
      timeout: 5000,
      ...config,
    });

  const alert = (message) =>
    notification({
      message,
      status: "danger",
    });

  const info = (message) =>
    notification({
      message,
      status: "success",
    });

  const fetchJson = (...args) =>
    fetch(...args)
      .then((res) =>
        res.ok
          ? res.status !== 204
            ? res.json()
            : null
          : res.text().then((text) => {
              throw new Error(text);
            })
      )
      .catch((err) => {
        alert(err.message);
      });

  new Vue({
    el: "#app",
    data: {
      desc: "",
      activeTimers: [],
      oldTimers: [],
      wsData: {},
      client: {},
    },
    methods: {
      getTimers(data, isActive) {
        return data.userTimers.filter((timer) => timer.isActive === isActive);
      },
      sendMessage(message) {
        this.client.send(JSON.stringify(message));
      },
      createTimer() {
        const description = this.desc;
        this.desc = "";
        fetchJson("/api/timers", {
          method: "post",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ description }),
        }).then(({ id }) => {
          info(`Created new timer "${description}" [${id}]`);
          this.sendMessage({ type: "all_timers" });
        });
      },
      stopTimer(id) {
        fetchJson(`/api/timers/${id}/stop`, {
          method: "post",
        }).then(() => {
          info(`Stopped the timer [${id}]`);
          this.sendMessage({ type: "all_timers" });
        });
      },
      formatTime(ts) {
        return new Date(ts).toTimeString().split(" ")[0];
      },
      formatDuration(d) {
        d = Math.floor(d / 1000);
        const s = d % 60;
        d = Math.floor(d / 60);
        const m = d % 60;
        const h = Math.floor(d / 60);
        return [h > 0 ? h : null, m, s]
          .filter((x) => x !== null)
          .map((x) => (x < 10 ? "0" : "") + x)
          .join(":");
      },
    },
    created() {
      const sessionId = SESSION_ID;
      const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
      this.client = new WebSocket(`${wsProtocol}//${location.host}?sessionId=${sessionId}`);

      // client.addEventListener("open", () => {
      //   console.log("OPEN");
      // });
      this.client.addEventListener("close", () => {
        console.log("CLOSE");
      });

      this.client.addEventListener("message", (message) => {
        try {
          this.wsData = JSON.parse(message.data);
        } catch (error) {
          return;
        }

        if (this.wsData.type === "all_timers") {
          this.activeTimers = this.getTimers(this.wsData, true);
          this.oldTimers = this.getTimers(this.wsData, false);
        }
      });
    },
  });
})();
