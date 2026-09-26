/**
 * Saved-shape copies of a school SharePoint page and the Outlook web inbox, used by
 * dev mode and the tests. The markup mirrors what the real pages expose to the readers.
 */

export const SHAREPOINT_FIXTURE = `<!doctype html><html><head><title>Year 10 Hub</title></head><body>
<header><nav role="navigation"><a href="/sites/home">Home</a><a href="/sites/y10">Year 10</a></nav></header>
<div id="spPageCanvasContent">
  <div data-automation-id="pageHeader"><h1>Year 10 Hub</h1></div>
  <div data-automation-id="newsItem"><a href="https://school.sharepoint.com/sites/y10/SitePages/Rugby.aspx">
    <div data-automation-id="newsItemTitle">Rugby fixtures moved to Thursday</div></a>
    <div data-automation-id="newsItemDescription">Bring boots and gum shield. Coaches leave at 1:45.</div>
    <time>2 days ago</time></div>
  <h2>Homework this week</h2>
  <p>Maths: Exercise 12, questions 1-8, due Monday.</p>
  <p>Chemistry: atoms worksheet q1-8 on the portal.</p>
  <h2>Chemistry mock</h2>
  <p>The chemistry mock is on Friday 9 October in the sports hall. Bring a calculator and a black pen.</p>
  <h3>Library</h3>
  <p>The library is open until 5pm Monday to Thursday for revision.</p>
</div>
<footer>© School</footer>
</body></html>`;

export const OUTLOOK_FIXTURE = `<!doctype html><html><head><title>Mail - Peter - Outlook</title></head><body>
<div role="listbox" aria-label="Message list">
  <div role="option" data-convid="AAQkAD1" aria-label="Unread Mr Hale Chemistry write-up">
    <span title="j.hale@school.org.uk">Mr Hale</span>
    <div>Chemistry write-up</div>
    <div>16:04</div>
    <div>Hi all, please bring your chemistry book on Monday. The write-up is due Monday, not Friday.</div>
  </div>
  <div role="option" data-convid="AAQkAD2" aria-label="Ms Okafor English essay plan">
    <span title="n.okafor@school.org.uk">Ms Okafor</span>
    <div>Essay plan</div>
    <div>Fri 12:30</div>
    <div>Essay plans for Macbeth act 3 are due by Wednesday. Use your act 3 notes.</div>
  </div>
  <div role="option" data-convid="AAQkAD3" aria-label="School Office Parents evening">
    <span title="office@school.org.uk">School Office</span>
    <div>Year 10 parents' evening</div>
    <div>Yesterday</div>
    <div>Parents' evening is on Thursday 15 October from 4pm. Booking opens today.</div>
  </div>
</div>
</body></html>`;
