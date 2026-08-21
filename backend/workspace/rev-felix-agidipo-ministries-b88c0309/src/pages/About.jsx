import { useEffect, useState } from "react";
import SectionDivider from "../components/SectionDivider";
import { getContent } from "../data/store";

const defaultValues = [
  {
    title: "The Word, Unshaken",
    text: "We hold Scripture as the final word on every matter of faith and life — taught in full, never edited for comfort.",
  },
  {
    title: "Prayer as Oxygen",
    text: "Every act of ministry here is preceded by intercession. We do not plan and then pray; we pray and then plan.",
  },
  {
    title: "Radical Hospitality",
    text: "The altar and the table are both open. No one is asked to look presentable before they are welcomed.",
  },
  {
    title: "Excellence Unto God",
    text: "From the choir stand to the church accounts, we offer our best because it is offered to Him, not to men.",
  },
];

const defaultTimeline = [
  {
    year: "1994",
    title: "The Call in Ilesha",
    text: "At a village crusade under a borrowed tent, a twenty-two-year-old Felix Agidipo surrendered to a call he had been running from since his teenage years.",
  },
  {
    year: "1999",
    title: "Bible College & First Pulpit",
    text: "Graduated from seminary and took up a modest assistant-pastor post, preaching to a congregation of eleven on his first Sunday.",
  },
  {
    year: "2006",
    title: "Founding of the Ministry",
    text: "With his wife, Pastor (Mrs) Deborah Agidipo, and nine founding members, planted what would become Rev. Felix Agidipo Ministries in a rented hall.",
  },
  {
    year: "2015",
    title: "The Anointing House is Built",
    text: "The congregation, grown to thousands, dedicated its permanent sanctuary — a house raised entirely on the freewill offerings of its members.",
  },
  {
    year: "Today",
    title: "A Ministry Across Borders",
    text: "Now shepherding congregations, media ministry, and mission outposts across three nations, Rev. Agidipo still visits the sick personally and answers his own messages.",
  },
];

export default function About() {
  const [content, setContent] = useState(null);

  useEffect(() => {
    setContent(getContent("about"));
    const handler = () => setContent(getContent("about"));
    window.addEventListener("content-updated", handler);
    return () => window.removeEventListener("content-updated", handler);
  }, []);

  const bio =
    content?.bio ||
    "Rev. Felix Agidipo is a teacher of the Word, a father to thousands, and a shepherd who believes that the pulpit and the pavement carry equal weight. For over three decades he has given his life to the plain, patient work of forming disciples — through exposition of Scripture, through the discipline of prayer, and through a stubborn insistence on being present in the ordinary lives of his people. He is married to Pastor (Mrs) Deborah Agidipo, and together they have raised both a family and a spiritual household that spans generations.";

  const vision =
    content?.vision ||
    "To raise a generation anointed for their assignment — men and women marked not by performance, but by the presence of God upon their lives, poured out in service to the Church and to the world.";

  const mission =
    content?.mission ||
    "To preach Christ without compromise, to disciple believers into maturity, and to extend practical compassion to the forgotten — one household, one city, one nation at a time.";

  const values = content?.values || defaultValues;
  const timeline = content?.timeline || defaultTimeline;

  return (
    <div className="page-about">
      {/* Header */}
      <header className="about-header">
        <div className="container about-header-grid">
          <p className="eyebrow">The Man &amp; The Mandate</p>
          <h1 className="display-xl">
            About <span className="gold-italic">Rev. Felix Agidipo</span>
          </h1>
          <p className="lede">
            A life poured out — thirty years of teaching, tears, and
            testimony, shaping a ministry built to outlast a single
            generation.
          </p>
        </div>
      </header>

      <SectionDivider />

      {/* Bio - asymmetric magazine grid */}
      <section className="section section-champagne">
        <div className="container bio-grid">
          <div className="bio-portrait" aria-hidden="true">
            <div className="bio-portrait-frame">
              <span className="bio-monogram">FA</span>
            </div>
            <p className="bio-caption">Rev. Felix Agidipo, Founder &amp; Senior Pastor</p>
          </div>

          <div className="bio-copy">
            <p className="eyebrow eyebrow-dark">Who He Is</p>
            <h2 className="display-lg">Shepherd first, minister second.</h2>
            <p className="body-lg">{bio}</p>
            <p className="body-lg">
              Those closest to him will tell you the same thing before they
              tell you anything else: he answers his phone. In a season when
              ministry has become a stage, Rev. Agidipo has insisted on
              remaining a pastor — visiting hospital wards, sitting through
              funerals in villages with no signal, and closing every service
              standing at the door to greet the last person leaving.
            </p>
            <blockquote className="pull-quote">
              "I was not called to be admired from a distance. I was called
              to be present — in the pulpit and in the pit."
              <cite>— Rev. Felix Agidipo</cite>
            </blockquote>
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* Vision & Mission */}
      <section className="section section-navy">
        <div className="container vm-grid">
          <div className="vm-card">
            <span className="vm-tag">Vision</span>
            <p className="vm-text">{vision}</p>
          </div>
          <div className="vm-card vm-card-accent">
            <span className="vm-tag">Mission</span>
            <p className="vm-text">{mission}</p>
          </div>
        </div>
      </section>

      <SectionDivider />

      {/* Journey timeline - genuine sequence */}
      <section className="section section-ivory">
        <div className="container">
          <p className="eyebrow eyebrow-dark">The Journey</p>
          <h2 className="display-lg section-heading">
            Three decades, one obedience.
          </h2>

          <ol className="timeline">
            {timeline.map((item, i) => (
              <li className="timeline-item" key={item.year + i}>
                <div className="timeline-year">{item.year}</div>
                <div className="timeline-body">
                  <h3 className="timeline-title">{item.title}</h3>
                  <p>{item.text}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <SectionDivider />

      {/* Core values */}
      <section className="section section-champagne">
        <div className="container">
          <p className="eyebrow eyebrow-dark">What Anchors Us</p>
          <h2 className="display-lg section-heading">Our Core Values</h2>

          <div className="values-grid">
            {values.map((v, i) => (
              <div className="value-card" key={v.title + i}>
                <span className="value-index">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="value-title">{v.title}</h3>
                <p className="value-text">{v.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <SectionDivider />
    </div>
  );
}