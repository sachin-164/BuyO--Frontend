// // include-header.js
// fetch('header.html')
//   .then(response => response.text())
//   .then(data => {
//     document.getElementById('header-placeholder').innerHTML = data;
//   });


fetch('header.html')
  .then(res => res.text())
  .then(data => {
    document.getElementById('header-placeholder').innerHTML = data;
    initHeader(); // Call the function from script.js
  });
