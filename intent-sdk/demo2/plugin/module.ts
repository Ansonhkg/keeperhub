export function activate() {
  return {
    key: "eval-exec-loop-v3",
    title: "Eval Exec Loop v3",
    capabilities: ["graph-native-workflows", "mcp", "http-discovery"],
  };
}

export default { activate };
