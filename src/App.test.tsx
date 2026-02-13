import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "./App";

type MockFile = File & { __dataUrl?: string; __text?: string };

class MockFileReader {
  onload: ((ev: { target: { result: string } }) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  result: string | null = null;

  readAsDataURL(file: MockFile) {
    this.result = file.__dataUrl || "data:image/jpeg;base64,stub";
    setTimeout(() => this.onload?.({ target: { result: this.result || "" } }), 0);
  }

  readAsText(file: MockFile) {
    this.result = file.__text || "";
    setTimeout(() => this.onload?.({ target: { result: this.result || "" } }), 0);
  }
}

class MockImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 2000;
  naturalHeight = 1500;
  width = 2000;
  height = 1500;
  private _src = "";

  set src(value: string) {
    this._src = value;
    setTimeout(() => this.onload?.(), 0);
  }

  get src() {
    return this._src;
  }
}

const originalUserAgent = navigator.userAgent;

beforeAll(() => {
  Object.defineProperty(window.navigator, "userAgent", {
    value: originalUserAgent,
    configurable: true,
  });
  (global as any).FileReader = MockFileReader;
  (global as any).Image = MockImage;
  HTMLCanvasElement.prototype.getContext = jest.fn(() => ({
    drawImage: jest.fn(),
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
  })) as any;
  HTMLCanvasElement.prototype.toDataURL = jest.fn(() => "data:image/jpeg;base64,compressed");
});

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
});

afterEach(() => {
  Object.defineProperty(window.navigator, "userAgent", {
    value: originalUserAgent,
    configurable: true,
  });
});

test("renders core sections", () => {
  render(<App />);
  expect(screen.getByText("Work Record Keeper")).toBeInTheDocument();
  expect(screen.getByText("Roster")).toBeInTheDocument();
  expect(screen.getAllByText("Upload Image").length).toBeGreaterThan(0);
  expect(screen.getByText("Item List")).toBeInTheDocument();
});

test("language toggle switches to zh-tw", () => {
  render(<App />);
  fireEvent.click(screen.getByText("中文"));
  expect(screen.getByText("工時記錄器")).toBeInTheDocument();
});

test("dark mode toggle updates body class", () => {
  render(<App />);
  fireEvent.click(screen.getByText("Dark"));
  expect(document.body.classList.contains("dark")).toBe(true);
});

test("add and remove job", () => {
  const promptSpy = jest.spyOn(window, "prompt").mockReturnValue("Side Job");
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

  render(<App />);
  fireEvent.click(screen.getByText("+ Job"));
  expect(screen.getByText("Side Job")).toBeInTheDocument();

  fireEvent.click(screen.getByText("Remove Job"));
  expect(screen.queryByText("Side Job")).not.toBeInTheDocument();
  expect(screen.getByText("Main Job")).toBeInTheDocument();

  promptSpy.mockRestore();
  confirmSpy.mockRestore();
});

test("add and remove item", () => {
  const { container } = render(<App />);
  const initialItems = container.querySelectorAll(".item-name");
  expect(initialItems.length).toBe(3);

  fireEvent.click(screen.getByText("+ Add Item"));
  const afterAdd = container.querySelectorAll(".item-name");
  expect(afterAdd.length).toBe(4);

  const removeButtons = screen.getAllByText("✕");
  fireEvent.click(removeButtons[removeButtons.length - 1]);
  const afterRemove = container.querySelectorAll(".item-name");
  expect(afterRemove.length).toBe(3);
});

test("auto-fill weekdays populates hours inputs", async () => {
  const promptSpy = jest.spyOn(window, "prompt").mockReturnValue("8");
  render(<App />);

  fireEvent.click(screen.getByText("Auto-fill Weekdays"));

  await waitFor(() => {
    const hoursInputs = screen.getAllByPlaceholderText("Hours") as HTMLInputElement[];
    expect(hoursInputs.some(input => input.value === "8")).toBe(true);
  });

  promptSpy.mockRestore();
});

test("reset month hours requires confirmation and clears values", async () => {
  const promptSpy = jest.spyOn(window, "prompt").mockReturnValue("8");
  render(<App />);

  fireEvent.click(screen.getByText("Auto-fill Weekdays"));
  await waitFor(() => {
    const hoursInputs = screen.getAllByPlaceholderText("Hours") as HTMLInputElement[];
    expect(hoursInputs.some(input => input.value === "8")).toBe(true);
  });

  fireEvent.click(screen.getByText("Reset Month Hours"));
  expect(screen.getByText("Reset this month's hours?")).toBeInTheDocument();
  fireEvent.click(screen.getByText("OK, Reset"));

  await waitFor(() => {
    const hoursInputs = screen.getAllByPlaceholderText("Hours") as HTMLInputElement[];
    expect(hoursInputs.every(input => input.value === "" || input.value === "0")).toBe(true);
  });

  promptSpy.mockRestore();
});

test("roster upload enables view and allows removal (mobile compression path)", async () => {
  Object.defineProperty(window.navigator, "userAgent", {
    value: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)",
    configurable: true,
  });

  const { container } = render(<App />);
  const uploadLabel = screen.getAllByText("Upload Image")[0].closest("label");
  expect(uploadLabel).toBeTruthy();

  const fileInput = uploadLabel!.querySelector("input[type=\"file\"]") as HTMLInputElement;
  const rosterItem = uploadLabel!.closest(".roster-item") as HTMLElement;
  const file = new File(["fake"], "roster.jpg", { type: "image/jpeg" }) as MockFile;
  file.__dataUrl = "data:image/jpeg;base64,original";

  fireEvent.change(fileInput, { target: { files: [file] } });

  await waitFor(() => {
    const viewButton = within(rosterItem).getByText("View Image") as HTMLButtonElement;
    expect(viewButton).toBeEnabled();
  });

  const removeButton = within(rosterItem).getByLabelText("Remove Photo");
  fireEvent.click(removeButton);
  fireEvent.click(screen.getByText("Yes, Remove"));

  await waitFor(() => {
    const viewButton = within(rosterItem).getByText("View Image") as HTMLButtonElement;
    expect(viewButton).toBeDisabled();
  });
});

test("export data triggers download", () => {
  if (!URL.createObjectURL) {
    (URL as any).createObjectURL = () => "blob:export";
  }
  if (!URL.revokeObjectURL) {
    (URL as any).revokeObjectURL = () => {};
  }
  const createObjectURLSpy = jest.spyOn(URL, "createObjectURL").mockReturnValue("blob:export");
  const revokeSpy = jest.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  render(<App />);
  fireEvent.click(screen.getByText("Export Data"));

  expect(createObjectURLSpy).toHaveBeenCalled();
  expect(clickSpy).toHaveBeenCalled();
  expect(revokeSpy).toHaveBeenCalled();
});

test("import data shows notification", async () => {
  render(<App />);
  const payload = {
    items: [{ id: 1, name: "Rent", price: 0, taxable: false, enabled: true }],
    hourlyRate: 20,
    startDate: "2025-01-01",
    dayHours: [],
    payCycle: "biweekly",
    roster: { weekly: {}, monthly: {} },
  };
  const file = new File([JSON.stringify(payload)], "import.json", { type: "application/json" }) as MockFile;
  file.__text = JSON.stringify(payload);

  const importLabel = screen.getByText("Import Data").closest("label");
  const importInput = importLabel!.querySelector("input[type=\"file\"]") as HTMLInputElement;
  fireEvent.change(importInput, { target: { files: [file] } });

  await waitFor(() => {
    expect(screen.getByText("Imported data")).toBeInTheDocument();
  });
});

test("app does not crash if localStorage is full", () => {
  const setItemSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("QuotaExceededError", "QuotaExceededError");
  });

  render(<App />);
  expect(screen.getByText("Work Record Keeper")).toBeInTheDocument();

  setItemSpy.mockRestore();
});
