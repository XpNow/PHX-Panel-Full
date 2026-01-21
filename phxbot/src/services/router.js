export function parseCustomId(customId){
  // format: namespace:action:arg1:arg2...
  const parts = customId.split(':');
  return { ns: parts[0], action: parts[1] || '', args: parts.slice(2) };
}
