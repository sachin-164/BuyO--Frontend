// document.addEventListener('DOMContentLoaded', () => {
//   const hamburger = document.querySelector('.hamburger');
//   const sidebar = document.querySelector('.sidebar');

//   if (hamburger && sidebar) {
//     hamburger.addEventListener('click', () => {
//       sidebar.classList.toggle('active');
//       hamburger.classList.toggle('active');
//     });
//   }



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

document.addEventListener("DOMContentLoaded", function () {
  const slides = document.querySelectorAll(".slide");
  const prevBtn = document.querySelector(".prev");
  const nextBtn = document.querySelector(".next");
  let index = 0;
  let slideInterval;

  function showSlide(i) {
    slides.forEach(slide => slide.classList.remove("active"));
    slides[i].classList.add("active");
  }

  function nextSlide() {
    index = (index + 1) % slides.length;
    showSlide(index);
  }

  function prevSlide() {
    index = (index - 1 + slides.length) % slides.length;
    showSlide(index);
  }

  function startAutoSlide() {
    slideInterval = setInterval(nextSlide, 3000);
  }

  function stopAutoSlide() {
    clearInterval(slideInterval);
  }

  nextBtn.addEventListener("click", () => {
    stopAutoSlide();
    nextSlide();
    startAutoSlide();
  });

  prevBtn.addEventListener("click", () => {
    stopAutoSlide();
    prevSlide();
    startAutoSlide();
  });

  showSlide(index);
  startAutoSlide();
});




