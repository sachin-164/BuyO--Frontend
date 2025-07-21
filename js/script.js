// document.addEventListener('DOMContentLoaded', () => {
//   const hamburger = document.querySelector('.hamburger');
//   const sidebar = document.querySelector('.sidebar');

//   if (hamburger && sidebar) {
//     hamburger.addEventListener('click', () => {
//       sidebar.classList.toggle('active');
//       hamburger.classList.toggle('active');
//     });
//   }

//   //Close the sidebar if the user clicks outside of it
//   document.addEventListener('click', (event) => {
//     if (sidebar.classList.contains('active') && !sidebar.contains(event.target) && !hamburger.contains(event.target)) {
//         sidebar.classList.remove('active');
//         hamburger.classList.remove('active');
//     }
//   });
// });

function initHeader() {
  const hamburger = document.querySelector('.hamburger');
  const sidebar = document.querySelector('.sidebar');

  if (hamburger && sidebar) {
    hamburger.addEventListener('click', () => {
      sidebar.classList.toggle('active');
      hamburger.classList.toggle('active');
    });

    document.addEventListener('click', (event) => {
      if (
        sidebar.classList.contains('active') &&
        !sidebar.contains(event.target) &&
        !hamburger.contains(event.target)
      ) {
        sidebar.classList.remove('active');
        hamburger.classList.remove('active');
      }
    });
  }
}


