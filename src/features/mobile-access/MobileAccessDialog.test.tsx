import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  MobileAccessDialog,
  type MobileAccessDialogProps,
  type MobileAccessLabels,
} from "./MobileAccessDialog";

const labels: MobileAccessLabels = {
  title: "移动访问",
  description: "让同一局域网中的手机浏览已选择的工作区。",
  close: "关闭",
  statusTitle: "服务状态",
  status: {
    stopped: "未开启",
    starting: "正在开启…",
    running: "已开启",
    stopping: "正在停止…",
    failed: "开启失败",
  },
  workspacesTitle: "共享工作区",
  workspacesDescription: "只会共享磁盘上已经保存的内容。",
  noWorkspaces: "请先在桌面端打开工作区。",
  selectionLocked: "停止服务后可修改",
  portDescription: "电脑与手机默认使用同一端口。",
  portInvalid: "请输入 1024–65535 之间的整数端口。",
  start: "开启移动访问",
  stop: "停止移动访问",
  serviceTitle: "连接信息",
  addressTitle: "局域网地址",
  addressUnavailable: "正在获取局域网地址…",
  portTitle: "端口",
  discoveryTitle: "自动发现",
  discovery: {
    starting: "正在发布…",
    active: "可被手机发现",
    unavailable: "不可用，可手动输入地址",
  },
  activeRequestsTitle: "活跃请求",
  activeRequestCount: (count) => `${count} 个`,
  copyAddress: "复制地址",
  copyingAddress: "正在复制…",
  copiedAddress: "已复制",
  copyFailed: "复制失败",
  refresh: "刷新状态",
  refreshing: "正在刷新…",
};

const workspaces = [
  { id: "workspace-b", name: "产品文档", detail: "~/Projects/product" },
  { id: "workspace-a", name: "个人笔记", detail: "~/Notes" },
] as const;

function createProps(
  overrides: Partial<MobileAccessDialogProps> = {},
): MobileAccessDialogProps {
  return {
    open: true,
    status: "stopped",
    workspaces,
    selectedWorkspaceIds: ["workspace-b"],
    port: "49920",
    labels,
    onClose: vi.fn(),
    onSelectionChange: vi.fn(),
    onPortChange: vi.fn(),
    onStart: vi.fn(),
    onStop: vi.fn(),
    onCopyAddress: vi.fn(),
    onRefresh: vi.fn(),
    ...overrides,
  };
}

describe("MobileAccessDialog", () => {
  it("renders nothing while closed", () => {
    render(<MobileAccessDialog {...createProps({ open: false })} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the saved default port and starts with selected workspaces", () => {
    const onStart = vi.fn();
    const onSelectionChange = vi.fn();
    render(
      <MobileAccessDialog
        {...createProps({
          onSelectionChange,
          onStart,
        })}
      />,
    );

    expect(screen.getByRole("dialog", { name: "移动访问" })).toBeVisible();
    expect(screen.queryByRole("note")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton", { name: "端口" })).toHaveValue(49_920);
    expect(screen.getByText("未开启")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: /产品文档/ })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /个人笔记/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: /个人笔记/ }));
    expect(onSelectionChange).toHaveBeenCalledExactlyOnceWith([
      "workspace-b",
      "workspace-a",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "开启移动访问" }));
    expect(onStart).toHaveBeenCalledExactlyOnceWith(49_920);
  });

  it("validates and reports a changed port before starting", () => {
    const onPortChange = vi.fn();
    const onStart = vi.fn();
    const { rerender } = render(
      <MobileAccessDialog {...createProps({ onPortChange, onStart })} />,
    );

    const port = screen.getByRole("spinbutton", { name: "端口" });
    fireEvent.change(port, { target: { value: "80" } });
    rerender(
      <MobileAccessDialog {...createProps({ onPortChange, onStart, port: "80" })} />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("1024–65535");
    expect(screen.getByRole("button", { name: "开启移动访问" })).toBeDisabled();
    expect(onPortChange).toHaveBeenCalledExactlyOnceWith("80");

    fireEvent.change(port, { target: { value: "50020" } });
    rerender(
      <MobileAccessDialog {...createProps({ onPortChange, onStart, port: "50020" })} />,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(onPortChange).toHaveBeenLastCalledWith("50020");
    fireEvent.click(screen.getByRole("button", { name: "开启移动访问" }));
    expect(onStart).toHaveBeenCalledExactlyOnceWith(50_020);
  });

  it("does not start without a selected workspace and explains an empty list", () => {
    const { rerender } = render(
      <MobileAccessDialog {...createProps({ selectedWorkspaceIds: [] })} />,
    );
    expect(screen.getByRole("button", { name: "开启移动访问" })).toBeDisabled();

    rerender(<MobileAccessDialog {...createProps({ workspaces: [] })} />);
    expect(screen.getByText("请先在桌面端打开工作区。")).toBeVisible();
  });

  it("locks workspace selection and presents live service information", () => {
    const onStop = vi.fn();
    render(
      <MobileAccessDialog
        {...createProps({
          status: "running",
          onStop,
          serverInfo: {
            addresses: ["http://192.168.1.42:41782", "http://10.0.0.5:41782"],
            port: 41782,
            discoveryStatus: "active",
            activeRequestCount: 3,
          },
        })}
      />,
    );

    expect(screen.getByText("已开启")).toBeVisible();
    expect(screen.getByText("可被手机发现")).toBeVisible();
    expect(screen.getByText("3 个")).toBeVisible();
    expect(screen.getByText("http://192.168.1.42:41782")).toBeVisible();
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).toBeDisabled();
    }
    expect(screen.getByText("停止服务后可修改")).toBeVisible();
    expect(screen.getByRole("spinbutton", { name: "端口" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "停止移动访问" }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("copies one connection address and reports a failed copy", async () => {
    const firstAddress = "http://192.168.1.42:41782";
    const secondAddress = "http://10.0.0.5:41782";
    const onCopyAddress = vi.fn(async (address: string) => {
      if (address === secondAddress) throw new Error("synthetic clipboard failure");
    });
    render(
      <MobileAccessDialog
        {...createProps({
          status: "running",
          onCopyAddress,
          serverInfo: {
            addresses: [firstAddress, secondAddress],
            port: 41782,
            discoveryStatus: "active",
            activeRequestCount: 0,
          },
        })}
      />,
    );

    const copyButtons = screen.getAllByRole("button", { name: "复制地址" });
    expect(copyButtons).toHaveLength(2);
    fireEvent.click(copyButtons[0]!);
    expect(await screen.findByRole("button", { name: "已复制" })).toBeVisible();
    expect(onCopyAddress).toHaveBeenCalledWith(firstAddress);

    fireEvent.click(screen.getAllByRole("button", { name: "复制地址" })[0]!);
    expect(await screen.findByRole("alert")).toHaveTextContent("复制失败");
    expect(onCopyAddress).toHaveBeenCalledWith(secondAddress);
  });

  it("coalesces repeated refresh clicks while status refresh is pending", async () => {
    let finishRefresh: (() => void) | undefined;
    const onRefresh = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    render(
      <MobileAccessDialog
        {...createProps({
          status: "running",
          onRefresh,
          serverInfo: {
            addresses: [],
            port: null,
            discoveryStatus: "starting",
            activeRequestCount: 0,
          },
        })}
      />,
    );

    expect(screen.getByText("正在获取局域网地址…")).toBeVisible();
    const refresh = screen.getByRole("button", { name: "刷新状态" });
    fireEvent.click(refresh);
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "正在刷新…" })).toBeDisabled();

    finishRefresh?.();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "刷新状态" })).toBeEnabled(),
    );
  });

  it("shows a failed state and closes with Escape", () => {
    const onClose = vi.fn();
    render(
      <MobileAccessDialog
        {...createProps({
          status: "failed",
          errorMessage: "端口已被其他应用占用。",
          onClose,
        })}
      />,
    );

    expect(screen.getByText("开启失败")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("端口已被其他应用占用。");
    expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
