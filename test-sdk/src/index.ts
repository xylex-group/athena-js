import dotenv from "dotenv";
import { createAthenaTestSdkServer } from "./server.js";

dotenv.config();
dotenv.config({ override: true, path: ".env.local" });

const ATHENA_URL =
  process.env.ATHENA_URL ?? "https://mirror3.athena-cluster.com";
const ATHENA_API_KEY = process.env.ATHENA_API_KEY ?? "";
const ATHENA_CLIENT = process.env.ATHENA_CLIENT ?? "athena_logging";

const portArg = process.argv.find((argument) => argument.startsWith("--port"));
const portFromArg = portArg
  ? Number(
      portArg.includes("=")
        ? portArg.split("=")[1]
        : process.argv[process.argv.indexOf(portArg) + 1]
    )
  : undefined;
const PORT = portFromArg ?? (Number(process.env.PORT) || 3000);

const server = createAthenaTestSdkServer({
  config: {
    athenaApiKey: ATHENA_API_KEY,
    athenaClient: ATHENA_CLIENT,
    athenaUrl: ATHENA_URL,
  },
});

server.expressApp.listen(PORT, () => {
  // ANSI color codes used directly for coloring
  const RESET = "\x1b[0m";
  const BOLD = "\x1b[1m";
  const CYAN = "\x1b[36m";
  const GREEN = "\x1b[32m";
  const GRAY = "\x1b[90m";
  const YELLOW = "\x1b[33m";
  const UNDERLINE = "\x1b[4m";

  console.log(`${BOLD}${CYAN}\n  Athena Test SDK${RESET}`);
  console.log(`${GRAY}  ----------------${RESET}`);
  console.log(
    `${GREEN}  •${RESET} Server: ${UNDERLINE}http://localhost:${PORT}${RESET}`
  );
  console.log(`${GRAY}  • ATHENA_URL: ${ATHENA_URL}${RESET}`);
  console.log(`${GRAY}  • ATHENA_CLIENT: ${ATHENA_CLIENT}${RESET}`);
  if (!ATHENA_API_KEY) {
    console.log(
      `${YELLOW}  ! ATHENA_API_KEY not set - requests may fail${RESET}`
    );
  }
  console.log("");
});
