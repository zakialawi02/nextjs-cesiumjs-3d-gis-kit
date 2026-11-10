"use client";

import { useLayoutEffect } from "react";

const HTML_CLASSES = ["h-dvh", "overflow-hidden", "overscroll-none"];
const BODY_CLASSES = ["h-dvh", "w-full", "overflow-hidden", "overscroll-none"];

/**
 * The Laravel map layout (layouts/app-front.blade.php) pins <html> and <body> to the viewport with
 * `h-dvh overflow-hidden overscroll-none`. The root layout is shared with the other pages, so this
 * adds those classes while the map is mounted and removes the ones it added afterwards.
 */
export function MapDocumentClasses() {
  useLayoutEffect(() => {
    const added: Array<[DOMTokenList, string]> = [];
    const add = (list: DOMTokenList, classes: string[]) => {
      classes.forEach((name) => {
        if (!list.contains(name)) {
          list.add(name);
          added.push([list, name]);
        }
      });
    };

    add(document.documentElement.classList, HTML_CLASSES);
    add(document.body.classList, BODY_CLASSES);

    return () => added.forEach(([list, name]) => list.remove(name));
  }, []);

  return null;
}
