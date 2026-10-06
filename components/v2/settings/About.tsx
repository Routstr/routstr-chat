"use client";

import React from "react";
import { APP_VERSION } from "@/lib/version";
import { Icon, Mark } from "../icons";
import { Grp, Head } from "./parts";

export default function About() {
  return (
    <>
      <Head title="About" />
      <Grp id="g-about" k="Routstr">
        <div className="st-about">
          <span className="st-mark">
            <Mark size={44} />
          </span>
          <div>
            <p className="st-about-n" data-anchor="">
              Routstr Chat
            </p>
            <p className="st-about-v">Version {APP_VERSION}</p>
          </div>
        </div>
        <p className="st-prose">
          A private way to talk to many models. You pay each reply in sats from
          an ecash wallet on this device. Requests go through independent
          providers, and none of them needs to know who you are.
        </p>
        <div className="st-links">
          {(
            [
              ["https://routstr.com", "routstr.com"],
              ["https://github.com/Routstr", "Source code"],
              ["https://routstr.com/routstrd", "routstrd, run your own node"],
            ] as const
          ).map(([href, t]) => (
            <a
              key={href}
              className="st-link-row"
              href={href}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="st-rt">{t}</span>
              <Icon name="out" size={16} />
            </a>
          ))}
        </div>
      </Grp>
    </>
  );
}
