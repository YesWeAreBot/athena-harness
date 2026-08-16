export default function createBodyAdapter(config) {
  return {
    id: config.id,
    name: config.name,
    state: {},
    start: async () => {},
  };
}
