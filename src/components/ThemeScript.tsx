// Runs before paint to set the resolved theme on <html> (and the status-bar
// theme-color), so there's no light flash before hydration. Mirrors the resolve
// logic in ThemeToggle. Kept dependency-free and inlined.
const THEME_SCRIPT = `(function(){try{
var t=localStorage.getItem('theme')||'system';
var dark=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.dataset.theme=dark?'dark':'light';
var m=document.querySelector('meta[name="theme-color"]');
if(m)m.setAttribute('content',dark?'#16130f':'#faf9f7');
}catch(e){}})();`;

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
