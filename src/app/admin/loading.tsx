export default function AdminLoading(){
  return <div className="loading-shell" role="status" aria-busy="true" aria-label="Loading administration">
    <div className="skeleton skeleton-kicker"/>
    <div className="skeleton skeleton-title"/>
    <div className="skeleton skeleton-copy"/>
    <div className="loading-strip">{[0,1,2].map((item)=><div className="skeleton" key={item}/>)}</div>
    <span className="sr-only">Loading administration…</span>
  </div>;
}
