export function UserMenu({ name }: { name: string }) {
  return (
    <form action="/api/auth/logout" method="post" className="flex items-center gap-3 text-sm">
      <span className="text-coal-400">Signed in as <span className="font-medium text-coal-100">{name}</span></span>
      <button type="submit" className="rounded-lg px-3 py-1.5 text-coal-300 hover:bg-coal-800 hover:text-coal-100">
        Sign out
      </button>
    </form>
  );
}
