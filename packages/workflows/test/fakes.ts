import type { GuildSnapshot, SnapshotChannel, SnapshotRole } from '@botcooks/shared';
import type { DiscordWriter, ExecutionStore, MessageBody, OpState, ResolvedChannelData, ResolvedConfig } from '../src/executor';
import type { RoleData } from '../src/changeset';

let seq = 800000000000000000n;
const nextId = () => (seq++).toString();

/** In-memory Discord guild that behaves like the REST API for the calls the executor makes. */
export class FakeGuild implements DiscordWriter {
  roles: SnapshotRole[];
  channels: SnapshotChannel[];
  messages: Array<{ id: string; channelId: string; body: MessageBody }> = [];
  calls: string[] = [];
  /** Fail the Nth call of a given method (1-based) with this error. */
  failures = new Map<string, { at: number; error: unknown }>();
  private counters = new Map<string, number>();
  /** Simulate a crash: throw after performing the write. */
  crashAfter?: string;

  constructor(snapshot: GuildSnapshot) {
    this.roles = structuredClone(snapshot.roles);
    this.channels = structuredClone(snapshot.channels);
  }

  private hit(method: string) {
    this.calls.push(method);
    const n = (this.counters.get(method) ?? 0) + 1;
    this.counters.set(method, n);
    const f = this.failures.get(method);
    if (f && f.at === n) throw f.error;
  }

  private crash(method: string) {
    if (this.crashAfter === method) {
      this.crashAfter = undefined;
      throw new Error('simulated worker crash');
    }
  }

  async createRole(data: RoleData) {
    this.hit('createRole');
    const id = nextId();
    this.roles.push({ id, ...data, position: 1, managed: false });
    this.crash('createRole');
    return { id };
  }
  async editRole(roleId: string, data: RoleData) {
    this.hit('editRole');
    const r = this.roles.find((x) => x.id === roleId);
    if (!r) throw Object.assign(new Error('Unknown Role'), { status: 404, code: 10011 });
    Object.assign(r, data);
  }
  async deleteRole(roleId: string) {
    this.hit('deleteRole');
    const before = this.roles.length;
    this.roles = this.roles.filter((r) => r.id !== roleId);
    if (before === this.roles.length) throw Object.assign(new Error('Unknown Role'), { status: 404, code: 10011 });
  }
  async setRolePositions(positions: Array<{ id: string; position: number }>) {
    this.hit('setRolePositions');
    for (const p of positions) {
      const r = this.roles.find((x) => x.id === p.id);
      if (r) r.position = p.position;
    }
  }
  async createChannel(data: ResolvedChannelData) {
    this.hit('createChannel');
    const id = nextId();
    this.channels.push({
      id,
      name: data.name,
      type: data.type,
      parentId: data.parentId,
      position: 0,
      topic: data.topic ?? null,
      nsfw: data.nsfw ?? false,
      rateLimitPerUser: data.rateLimitPerUser ?? 0,
      userLimit: data.userLimit ?? 0,
      overwrites: data.overwrites,
    });
    this.crash('createChannel');
    return { id };
  }
  async editChannel(channelId: string, data: ResolvedChannelData) {
    this.hit('editChannel');
    const c = this.channels.find((x) => x.id === channelId);
    if (!c) throw Object.assign(new Error('Unknown Channel'), { status: 404, code: 10003 });
    Object.assign(c, { name: data.name, parentId: data.parentId, overwrites: data.overwrites, topic: data.topic ?? null });
  }
  async deleteChannel(channelId: string) {
    this.hit('deleteChannel');
    const before = this.channels.length;
    this.channels = this.channels.filter((c) => c.id !== channelId);
    if (before === this.channels.length) throw Object.assign(new Error('Unknown Channel'), { status: 404, code: 10003 });
  }
  async sendMessage(channelId: string, body: MessageBody) {
    this.hit('sendMessage');
    // Discord de-duplicates on nonce (enforce_nonce): emulate that.
    const dup = body.nonce ? this.messages.find((m) => m.body.nonce === body.nonce) : undefined;
    if (dup) return { id: dup.id };
    const id = nextId();
    this.messages.push({ id, channelId, body });
    return { id };
  }
  async deleteMessage(_channelId: string, messageId: string) {
    this.hit('deleteMessage');
    this.messages = this.messages.filter((m) => m.id !== messageId);
  }
  async listRoles() {
    return structuredClone(this.roles);
  }
  async listChannels() {
    return structuredClone(this.channels);
  }
  async botHighestRolePosition() {
    return 5;
  }
}

export class MemoryStore implements ExecutionStore {
  states = new Map<string, OpState>();
  mappings = new Map<string, string>();
  cancelled = false;
  config: unknown = { previous: true };
  appliedConfigs: ResolvedConfig[] = [];
  panels: Array<{ channelId: string; messageId: string; roleIds: string[] }> = [];
  progressLog: string[] = [];

  constructor(initialMappings: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initialMappings)) this.mappings.set(k, v);
  }
  async getOpState(id: string) {
    return this.states.get(id);
  }
  async setOpState(id: string, state: OpState) {
    this.states.set(id, state);
  }
  getMapping(ref: string) {
    return this.mappings.get(ref);
  }
  async setMapping(ref: string, id: string) {
    this.mappings.set(ref, id);
  }
  isDiscordIdMapped(id: string) {
    return [...this.mappings.values()].includes(id);
  }
  async isCancelled() {
    return this.cancelled;
  }
  async applyConfig(resolved: ResolvedConfig) {
    const previous = this.config;
    this.appliedConfigs.push(resolved);
    this.config = { applied: resolved.config, modLog: resolved.resolve(resolved.config.moderation.modLogChannel) };
    return { previous };
  }
  async restoreConfig(previous: unknown) {
    this.config = previous;
  }
  async registerSelfRolePanel(input: { channelId: string; messageId: string; roleIds: string[] }) {
    this.panels.push(input);
  }
  async progress(done: number, total: number, label: string) {
    this.progressLog.push(`${done}/${total} ${label}`);
  }
}
