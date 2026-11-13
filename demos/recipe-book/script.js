// ===== 作物データ（収穫月） =====
const crops = {
  melon: { name: "メロン", icon: "🍈", color: "var(--melon)", months: [4, 5, 6] },
  zucchini: { name: "ズッキーニ", icon: "🥒", color: "var(--zucchini)", months: [3, 4, 5] },
  chestnut: { name: "栗", icon: "🌰", color: "var(--chestnut)", months: [8, 9, 10] },
  rice: { name: "お米", icon: "🍚", color: "var(--rice)", months: [9, 10] },
};

// ===== レシピデータ =====
// レシピを追加するときはこの配列に追記する
const recipes = [
  {
    crop: "melon",
    title: "完熟メロンと生ハムのひと皿",
    desc: "ぼかし肥料で甘みをのせたメロンに、生ハムの塩気がよく合います。",
    time: "10分",
    serves: "2人分",
    ingredients: ["メロン 1/4個", "生ハム 6枚", "オリーブオイル 少々", "黒こしょう 少々"],
    steps: [
      "メロンは種を取り、皮をむいて食べやすいくし形に切る。",
      "メロンに生ハムを巻きつけるようにのせる。",
      "オリーブオイルをまわしかけ、黒こしょうをふる。",
    ],
    tip: "冷やしすぎると甘みを感じにくくなります。食べる30分前に冷蔵庫から出すのがおすすめ。",
  },
  {
    crop: "melon",
    title: "まるごとメロンスムージー",
    desc: "形が不ぞろいなメロンも、牛乳と合わせてごちそうドリンクに。",
    time: "5分",
    serves: "2人分",
    ingredients: ["メロン（冷凍しておく） 200g", "牛乳 150ml", "ヨーグルト 大さじ3", "はちみつ お好みで"],
    steps: [
      "メロンはひと口大に切って冷凍しておく。",
      "すべての材料をミキサーに入れ、なめらかになるまで回す。",
      "グラスに注いでできあがり。",
    ],
    tip: "完熟して柔らかくなったメロンこそ、スムージー向き。香りがぐっと強くなります。",
  },
  {
    crop: "melon",
    title: "メロンの皮ぎわ浅漬け",
    desc: "皮の近くの白い部分は、きゅうりのような食感。捨てずにおいしく。",
    time: "10分＋漬け時間",
    serves: "作りやすい分量",
    ingredients: ["メロンの皮ぎわ（白い部分） 1個分", "塩 小さじ1/2", "昆布 5cm", "しょうが（千切り） 少々"],
    steps: [
      "外側の硬い皮をむき、白い部分を薄切りにする。",
      "ポリ袋にすべての材料を入れてよくもむ。",
      "冷蔵庫で1時間以上漬ける。",
    ],
    tip: "農家の食卓の定番。無駄なく食べきれます。",
  },
  {
    crop: "zucchini",
    title: "ズッキーニの豚肉巻き焼き",
    desc: "とれたてのみずみずしいズッキーニを、豚肉で巻いてジューシーに。",
    time: "20分",
    serves: "2〜3人分",
    ingredients: ["ズッキーニ 1本", "豚バラ薄切り肉 8枚", "塩・こしょう 少々", "しょうゆ 大さじ1", "みりん 大さじ1"],
    steps: [
      "ズッキーニを縦に8等分のスティック状に切る。",
      "豚肉を巻きつけ、塩・こしょうをふる。",
      "巻き終わりを下にしてフライパンで焼き、全体に焼き色をつける。",
      "しょうゆとみりんを加えて絡める。",
    ],
    tip: "朝どりのズッキーニは皮がやわらかいので、皮ごと使ってください。",
  },
  {
    crop: "zucchini",
    title: "ズッキーニのごま塩ナムル",
    desc: "生のままポリポリ。あと一品ほしいときにすぐできます。",
    time: "5分",
    serves: "2人分",
    ingredients: ["ズッキーニ 1本", "塩 小さじ1/3", "ごま油 大さじ1", "白いりごま 大さじ1", "にんにく（すりおろし） 少々"],
    steps: [
      "ズッキーニを薄い輪切りにし、塩をふって5分おく。",
      "出てきた水気を軽くしぼる。",
      "ごま油、ごま、にんにくで和える。",
    ],
    tip: "新鮮なものほど青臭さがなく、生食でも甘みを感じられます。",
  },
  {
    crop: "zucchini",
    title: "ズッキーニのチーズ焼き",
    desc: "輪切りにのせて焼くだけ。子どもにも人気のおかず。",
    time: "15分",
    serves: "2人分",
    ingredients: ["ズッキーニ 1本", "ピザ用チーズ 50g", "ケチャップ 大さじ2", "乾燥パセリ 少々"],
    steps: [
      "ズッキーニを1cm幅の輪切りにする。",
      "天板に並べ、ケチャップとチーズをのせる。",
      "トースターで7〜8分、チーズに焼き色がつくまで焼く。",
      "パセリをふる。",
    ],
    tip: "大きく育ちすぎたズッキーニは、この食べ方がおすすめです。",
  },
  {
    crop: "chestnut",
    title: "栗の渋皮煮",
    desc: "手間はかかりますが、秋にしか作れない農家のごちそう。",
    time: "約3時間",
    serves: "作りやすい分量",
    ingredients: ["栗 1kg", "重曹 小さじ2（2回分）", "砂糖 500〜600g", "水 適量"],
    steps: [
      "栗をぬるま湯に1時間つけ、渋皮を傷つけないよう鬼皮をむく。",
      "たっぷりの水と重曹小さじ1で15分ゆで、ゆで汁を捨てて水洗いする。これをもう1回くり返す。",
      "太い筋を竹串で取りのぞき、水からゆでて10分ほど煮る。",
      "砂糖を3回に分けて加え、弱火で30分煮て、そのまま一晩おく。",
    ],
    tip: "煮汁ごと瓶に詰めて冷蔵庫で保存できます。お正月まで楽しめます。",
  },
  {
    crop: "chestnut",
    title: "焼き栗",
    desc: "フライパンひとつで、ほくほくの焼き栗に。",
    time: "30分",
    serves: "作りやすい分量",
    ingredients: ["栗 300g", "塩 少々"],
    steps: [
      "栗を水に30分つけ、包丁で平らな面に切れ目を入れる。",
      "フライパンに並べてふたをし、弱めの中火で15分焼く。",
      "裏返してさらに10分焼き、塩をふる。",
    ],
    tip: "収穫後に冷蔵庫（0℃前後）で1〜2週間ねかせると、でんぷんが糖に変わって甘くなります。",
  },
  {
    crop: "rice",
    title: "新米の塩むすび",
    desc: "いちばんシンプルで、いちばんお米の味がわかる食べ方。",
    time: "炊飯時間＋5分",
    serves: "4個分",
    ingredients: ["新米 1合", "水 1合分の目盛りより少なめ", "塩 少々"],
    steps: [
      "お米はやさしくとぎ、30分以上浸水させる。",
      "新米は水分が多いので、水加減はいつもより少し控えめにして炊く。",
      "手を水でぬらし、塩を手のひらにのばして、ふんわりにぎる。",
    ],
    tip: "ぎゅっと固くにぎらないのがコツ。口の中でほどけるくらいが一番おいしいです。",
  },
  {
    crop: "rice",
    title: "栗ごはん",
    desc: "自家製の栗と新米で。秋の収穫がそろうこの時期だけのごはん。",
    time: "炊飯時間＋30分",
    serves: "4人分",
    ingredients: ["米 2合", "もち米 0.5合（お好みで）", "栗（皮をむいたもの） 15個", "酒 大さじ2", "塩 小さじ1", "昆布 5cm"],
    steps: [
      "米ともち米をといで30分浸水させる。",
      "栗は熱湯に10分つけてから鬼皮と渋皮をむき、水にさらす。",
      "炊飯器に米、酒、塩を入れて目盛りまで水を加え、昆布と栗をのせて炊く。",
      "炊きあがったら昆布を取り出し、栗をくずさないように混ぜる。",
    ],
    tip: "栗も米も同じ時期にとれる、みどり農園いちばんのおすすめレシピです。",
  },
  {
    crop: "rice",
    title: "おこげのだし茶漬け",
    desc: "土鍋で炊いたときのおこげを、香ばしいお茶漬けに。",
    time: "10分",
    serves: "1人分",
    ingredients: ["おこげ ごはん茶碗1杯分", "だし汁 200ml", "塩 少々", "刻みのり・わさび お好みで"],
    steps: [
      "だし汁を温め、塩で味をととのえる。",
      "茶碗におこげを入れ、熱いだし汁を注ぐ。",
      "のりとわさびをのせる。",
    ],
    tip: "おこげの香ばしさで、お米そのものの甘みがよりわかります。",
  },
];

// ===== 収穫カレンダーを描画 =====
function renderCalendar() {
  const body = document.getElementById("calendar-body");
  const nowMonth = new Date().getMonth() + 1;

  // 今月の列見出しを強調
  const headCells = document.querySelectorAll(".calendar-table thead th");
  headCells[nowMonth].classList.add("is-now");

  Object.values(crops).forEach((crop) => {
    const row = document.createElement("tr");
    let html = `<th scope="row">${crop.icon} ${crop.name}</th>`;
    for (let m = 1; m <= 12; m++) {
      const isHarvest = crop.months.includes(m);
      html += isHarvest
        ? `<td><span class="harvest-bar" style="background:${crop.color}" title="${m}月 収穫"></span></td>`
        : "<td></td>";
    }
    row.innerHTML = html;
    body.appendChild(row);
  });

  // 今が旬の作物を表示
  const inSeason = Object.values(crops).filter((c) => c.months.includes(nowMonth));
  const note = document.getElementById("season-now");
  note.textContent = inSeason.length
    ? `${nowMonth}月の旬：${inSeason.map((c) => c.icon + c.name).join("、")}`
    : `${nowMonth}月は収穫の端境期です。次の旬をお楽しみに。`;
}

// ===== レシピカードを描画 =====
function renderRecipes() {
  const grid = document.getElementById("recipe-grid");

  recipes.forEach((r) => {
    const crop = crops[r.crop];
    const card = document.createElement("article");
    card.className = "recipe-card";
    card.dataset.crop = r.crop;
    card.style.setProperty("--crop-color", crop.color);

    card.innerHTML = `
      <div class="recipe-head">
        <span class="recipe-tag">${crop.icon} ${crop.name}</span>
        <h3 class="recipe-title">${r.title}</h3>
        <p class="recipe-desc">${r.desc}</p>
        <p class="recipe-meta"><span>⏱ ${r.time}</span><span>🍽 ${r.serves}</span></p>
      </div>
      <details class="recipe-detail">
        <summary>材料と作り方を見る</summary>
        <h4>材料</h4>
        <ul>${r.ingredients.map((i) => `<li>${i}</li>`).join("")}</ul>
        <h4>作り方</h4>
        <ol>${r.steps.map((s) => `<li>${s}</li>`).join("")}</ol>
        <p class="farmer-tip"><strong>農家のひとこと：</strong>${r.tip}</p>
      </details>
    `;
    grid.appendChild(card);
  });
}

// ===== 作物で絞り込み =====
function setupFilter() {
  const buttons = document.querySelectorAll(".filter-btn");

  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.dataset.filter;

      buttons.forEach((b) => b.classList.toggle("is-active", b === btn));
      document.querySelectorAll(".recipe-card").forEach((card) => {
        card.hidden = target !== "all" && card.dataset.crop !== target;
      });
    });
  });
}

renderCalendar();
renderRecipes();
setupFilter();
