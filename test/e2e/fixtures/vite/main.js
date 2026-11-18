document.querySelector('#app').innerHTML = `
  <h1 id="title">Fixture title</h1>
  <p id="text">Some text to point at.</p>
  <button id="cta">Call to action</button>
  <a id="spa-link" href="/spa-route">Client-side route</a>
`
// A single-page app's router: the path changes, the page doesn't reload.
document.querySelector('#spa-link').addEventListener('click', (e) => {
  e.preventDefault()
  history.pushState({}, '', '/spa-route')
  document.querySelector('#title').textContent = 'Fixture title'
})
