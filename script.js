// ハンバーガーメニューの開閉とフッターの年号表示を行う

document.addEventListener("DOMContentLoaded", () => {
  const navToggle = document.querySelector(".nav-toggle");
  const navList = document.querySelector(".nav-list");

  if (navToggle && navList) {
    navToggle.addEventListener("click", () => {
      navList.classList.toggle("is-open");
    });

    // メニュー内のリンクをタップしたら自動で閉じる
    navList.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        navList.classList.remove("is-open");
      });
    });
  }

  const yearEl = document.querySelector("[data-year]");
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }
});
