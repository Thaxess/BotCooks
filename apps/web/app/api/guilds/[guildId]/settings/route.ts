import { getSettings } from '@botcooks/database';
import { guildRoute, json } from '@/lib/server/api';
import { server } from '@/lib/server/context';

export const GET = guildRoute({ type: 'view' }, async ({ guildId }) => {
  const { settings, version } = await getSettings(server().db, guildId);
  return json({ settings, version });
});
