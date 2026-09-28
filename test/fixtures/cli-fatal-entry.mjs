export async function runCLI() {
  setTimeout(() => {
    throw new Error("fixture fatal failure");
  }, 50);
  return new Promise(() => {
    setInterval(() => {}, 1000);
  });
}
