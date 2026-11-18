document.querySelector('#root').innerHTML = '<h1 id="shell-title">Shell header</h1><p>Shell text outside the microfrontend.</p><section data-mfe="remote"></section>'
import('remote/widget').then(({ mount }) => mount(document.querySelector('[data-mfe="remote"]')))
