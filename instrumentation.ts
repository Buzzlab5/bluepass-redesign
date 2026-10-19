/** Runs once when a server starts. Wires outreach (Instantly sender, team alerts) into the agent runtime. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { wireOutreach } = await import("./lib/services/outreach/wire");
    wireOutreach();
  }
}
