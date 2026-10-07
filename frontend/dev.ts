const bun = process.execPath;
const api = Bun.spawn([bun, "--hot", "server.ts"], {
  cwd: import.meta.dir,
  env: { ...process.env, PORT: "3001" },
  stdout: "inherit",
  stderr: "inherit",
});
const web = Bun.spawn([bun, "run", "vite", "--host", "127.0.0.1"], {
  cwd: import.meta.dir,
  stdout: "inherit",
  stderr: "inherit",
});

const stop = () => {
  api.kill();
  web.kill();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

const code = await Promise.race([api.exited, web.exited]);
stop();
process.exit(code);
