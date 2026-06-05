export default function Page() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        textAlign: 'center',
        padding: 24,
      }}
    >
      <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.14em' }}>BUM BOT</div>
      <div style={{ color: '#8a93a0', fontSize: 14 }}>Status Board · deploy pipeline online</div>
    </main>
  );
}
