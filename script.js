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

  glueParagraphEnds();
});

// 作品ページの文章で、最後の行が「す。」のように1〜3文字だけにならないよう、
// 文末の4文字を改行しないひとまとまり（.end-glue）にする
function glueParagraphEnds() {
  const GLUE_LENGTH = 4;
  const targets = document.querySelectorAll(
    ".work-hero-lead, .work-content p, .work-content li"
  );

  targets.forEach((el) => {
    // いちばん最後の、文字が入っているテキストを探す
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let lastText = null;
    let node;
    while ((node = walker.nextNode())) {
      if (node.data.trim()) lastText = node;
    }
    if (!lastText) return;

    // すでに改行しない指定の中にある文字は触らない
    if (lastText.parentElement.closest(".end-glue, .nw, .voice-app")) return;

    const text = lastText.data.replace(/\s+$/, "");
    // 短い文は1行に収まるので何もしない
    if (text.length < GLUE_LENGTH * 2) return;

    const cut = text.length - GLUE_LENGTH;
    const glue = document.createElement("span");
    glue.className = "end-glue";
    glue.textContent = text.slice(cut);

    const parent = lastText.parentNode;
    parent.insertBefore(document.createTextNode(text.slice(0, cut)), lastText);
    parent.insertBefore(glue, lastText);
    parent.removeChild(lastText);
  });
}
